'use strict';

/**
 * 打包版 EXE 的端到端验证（不需要 Electron，纯 Node）
 *
 * 做的事：
 *   1. 起一个本地 http 服务，把 test/fixture.html 当成「假 ewt360 站点」发出去
 *   2. 启动 dist\win-unpacked\升学E网通助手.exe，并把 URL 作为参数传进去
 *   3. 页面里的助手脚本干完活后，POST /report 把结果回报过来
 *   4. 校验 8 项
 *
 * 运行： node test/packaged.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
// 新版本在 dist/win-unpacked（旧 dist/ 里可能有被锁住的进程占着）
const EXE = [
  path.join(ROOT, 'dist', 'win-unpacked', '升学E网通助手.exe'),
  path.join(ROOT, 'dist', 'win-unpacked', '升学E网通助手.exe')
].find((p) => fs.existsSync(p));
const FIXTURE = path.join(__dirname, 'fixture.html');

if (!EXE) {
  console.error('找不到打包产物：请先跑 build-exe.ps1 或 electron-builder --win dir --x64');
  process.exit(2);
}

let report = null;
const html = fs.readFileSync(FIXTURE);

const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { report = JSON.parse(body); } catch (e) { report = { parseError: String(e) }; }
      res.writeHead(204).end();
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port;
  console.log('测试站点已就绪： http://127.0.0.1:' + port + '/');
  console.log('启动打包版 EXE …');

  // 故意不加任何启动参数 —— 完全模拟「用户双击 exe」的行为。
  // App 内部会自己处理沙箱与数据目录（见 main.js 的「受限环境自愈」）。
  const child = spawn(EXE, ['http://127.0.0.1:' + port + '/'], {
    env: Object.assign({}, process.env, { EWT_TEST: '1', NODE_OPTIONS: '' }),
    stdio: 'ignore',
    detached: false
  });

  child.on('error', (e) => { console.error('EXE 启动失败：', e); process.exit(2); });

  const deadline = Date.now() + 40000;
  const tick = setInterval(() => {
    if (report || Date.now() > deadline) {
      clearInterval(tick);
      finish();
    }
  }, 500);

  function finish() {
    try { child.kill(); } catch (e) {}
    // 现在双击的是启动器（它转交参数后就退出），真正跑着的是 app.exe
    try {
      require('child_process').spawnSync('taskkill', ['/F', '/IM', 'app.exe'], { stdio: 'ignore' });
    } catch (e) {}
    try {
      require('child_process').spawnSync('taskkill', ['/F', '/IM', '升学E网通助手.exe'], { stdio: 'ignore' });
    } catch (e) {}
    srv.close();

    if (!report) {
      console.error('\n❌ 40 秒内没收到页面回报——EXE 可能没起来，或助手脚本没注入');
      process.exit(1);
    }

    const L = report.log || {};
    const checks = [
      ['EXE 能启动并加载页面', true],
      ['脚本已注入 (window.__EWT)', report.hasApi === true],
      ['控制面板已渲染 (.ewt-root)', report.panel === true],
      ['总开关默认已开', report.cfgEnabled === true],
      ['① 强制倍速锁死 4x（站点改回 1x 无效）', Math.abs(report.rate - 4) < 0.01],
      ['② 自动过检点掉了「点击通过检查」', (L.checks || 0) >= 1],
      ['③ 自动跳题点掉了「跳过」', (L.skips || 0) >= 1],
      ['④ 自动连播切到了第 2 节', L.next === 2],
      ['⑤ isTrusted 校验被绕过（0 次误判）', (L.isTrustedFail || 0) === 0]
    ];

    console.log('\n=== 打包版 EXE 端到端验证 ===');
    let pass = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ✅ ' : '  ❌ ') + name);
      if (ok) pass++;
    }
    console.log('\n原始回报: ' + JSON.stringify({ rate: report.rate, cfgSpeed: report.cfgSpeed, log: L }));
    console.log('通过 ' + pass + '/' + checks.length + '\n');
    process.exit(pass === checks.length ? 0 : 1);
  }
});
