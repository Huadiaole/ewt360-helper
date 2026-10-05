'use strict';

/**
 * 离线仿真测试台 —— 不联网、不碰真实站点，验证四件事：
 *   1) 强制倍速：站点每 300ms 改回 1x，我们是否锁得住 4x
 *   2) 自动过检：弹出的「点击通过检查」是否被点掉
 *   3) 自动跳题：课中选择题的「跳过」是否被点掉
 *   4) 自动连播：视频播完是否切到下一节
 *   5) isTrusted 绕过：站点对合成点击的校验是否被绕过
 *
 * 运行： npx electron test/smoke.js
 */

const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.EWT_TEST = '1';                    // 放开 preload 的域名限制
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const FIXTURE = path.join(__dirname, 'fixture.html');
const PROFILE = path.join(__dirname, '.smoke-profile');

// 每次跑都清掉配置目录，避免上一轮的 localStorage 影响结果
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
app.setPath('userData', PROFILE);

function serve() {
  return new Promise((resolve) => {
    const html = fs.readFileSync(FIXTURE);
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const srv = await serve();
  const port = srv.address().port;

  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  win.webContents.on('console-message', (e, level, message) => {
    if (/\[ewt/.test(message)) console.log('   │ ' + message);
  });

  await win.loadURL('http://127.0.0.1:' + port + '/');
  console.log('\n=== 加载仿真页面，等待各模块跑满 9 秒 ===\n');
  await wait(9000);

  const res = await win.webContents.executeJavaScript(`(function () {
    var v = document.querySelector('video');
    return {
      hasApi: !!window.__EWT,
      panel: !!document.querySelector('.ewt-root'),
      rate: v ? v.playbackRate : null,
      cfgSpeed: window.__EWT ? window.__EWT.CFG.speed : null,
      cfgEnabled: window.__EWT ? window.__EWT.CFG.enabled : null,
      log: window.__log
    };
  })()`);

  const L = res.log || {};
  const checks = [
    ['脚本已注入 (window.__EWT)', res.hasApi === true],
    ['控制面板已渲染 (.ewt-root)', res.panel === true],
    ['总开关默认已开', res.cfgEnabled === true],
    ['① 强制倍速锁死 4x（站点改回 1x 无效）', Math.abs(res.rate - 4) < 0.01],
    ['② 自动过检点掉了「点击通过检查」', (L.checks || 0) >= 1],
    ['③ 自动跳题点掉了「跳过」', (L.skips || 0) >= 1],
    ['④ 自动连播切到了第 2 节', L.next === 2],
    ['⑤ isTrusted 校验被绕过（0 次误判）', (L.isTrustedFail || 0) === 0]
  ];

  console.log('\n=== 冒烟测试结果 ===');
  let pass = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? '  ✅ ' : '  ❌ ') + name);
    if (ok) pass++;
  }
  console.log('\n原始数据: ' + JSON.stringify({ rate: res.rate, cfgSpeed: res.cfgSpeed, log: L }));
  console.log('通过 ' + pass + '/' + checks.length + '\n');

  try { srv.close(); } catch (e) {}
  app.exit(pass === checks.length ? 0 : 1);
}).catch((e) => {
  console.error('测试台自身出错：', e);
  app.exit(2);
});
