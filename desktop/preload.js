'use strict';

/**
 * 预加载脚本 —— 在每个 frame 的 document-start 阶段执行
 * 作用：把 ewt360-helper.user.js 注入到「主世界」，抢在站点脚本之前
 *      → 倍速劫持 / isTrusted 绕过 都能在第一时间装好
 */

(function () {
  // 只对 ewt360 域名生效（含 iframe 里的播放器页）
  var host = '';
  try { host = location.hostname || ''; } catch (e) { return; }
  // EWT_TEST=1 时放开域名限制（离线仿真测试台用）
  var testing = false;
  try { testing = process.env.EWT_TEST === '1'; } catch (e) {}
  if (!testing && !/(^|\.)ewt360\.com$/i.test(host)) return;

  if (window.__EWT_LOADED__ || window.__EWT_HOST_READY__) return;
  window.__EWT_HOST_READY__ = true;

  // 宿主预设：桌面版默认全开、4 倍速（用户仍可在面板里改）
  var PRESET = {
    enabled: true,
    forceSpeed: true,
    speed: 4,
    mute: false,
    autoNext: true,
    autoSkip: true,
    autoCheck: true,
    autoResume: true,
    nextMode: 'ended',
    answerStrategy: 'auto'
  };

  var code = '';
  try {
    var fs = require('fs');
    var path = require('path');
    // 打包后读同级副本；开发时直接读仓库真源 ../src/ewt360-helper.user.js
    var candidates = [
      path.join(__dirname, 'ewt360-helper.user.js'),
      path.join(__dirname, '..', 'src', 'ewt360-helper.user.js')
    ];
    var hit = null;
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(candidates[i])) { hit = candidates[i]; break; }
    }
    if (!hit) throw new Error('找不到 ewt360-helper.user.js');
    code = fs.readFileSync(hit, 'utf8');
  } catch (e) {
    console.error('[ewt host] 读取脚本失败：', e);
    return;
  }

  // 剥掉 UserScript 元数据块（宿主环境不需要）
  code = code.replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/, '');

  try { window.__EWT_PRESET = PRESET; } catch (e) {}
  try { window.__EWT_HOST = 'electron'; } catch (e) {}

  try {
    (0, eval)(code);
  } catch (e) {
    console.error('[ewt host] 注入失败：', e);
  }
})();
