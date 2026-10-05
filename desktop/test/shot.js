'use strict';

/**
 * 给助手面板拍张照（用 Electron 的 capturePage，不依赖桌面会话）
 * 运行： npx electron --no-sandbox test/shot.js
 * 产物： test/screenshot.png
 */

const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.EWT_TEST = '1';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setPath('userData', path.join(__dirname, '.shot-profile'));

const FIXTURE = path.join(__dirname, 'fixture.html');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const html = fs.readFileSync(FIXTURE);
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    show: true,          // 必须可见：隐藏窗口时 Chromium 不产帧，CSS 过渡会卡在起始值
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  await win.loadURL('http://127.0.0.1:' + srv.address().port + '/');
  await wait(6000);                                   // 等助手把活干完
  const dbg1 = await win.webContents.executeJavaScript(
    "JSON.stringify({root:!!document.querySelector('.ewt-root'),fab:!!document.querySelector('.ewt-fab'),panel:!!document.querySelector('.ewt-panel'),cls:(document.querySelector('.ewt-panel')||{}).className})"
  );
  console.log('  点击前: ' + dbg1);
  await win.webContents.executeJavaScript(
    "document.querySelector('.ewt-fab').click(); 1"  // 打开面板
  );
  await wait(1000);
  const dbg2 = await win.webContents.executeJavaScript(
    "(function(){var p=document.querySelector('.ewt-panel');var st=document.getElementById('ewt-style');" +
    "var sheet=null;try{sheet=Array.from(document.styleSheets).find(function(s){return s.ownerNode&&s.ownerNode.id==='ewt-style';});}catch(e){}" +
    "var info={cls:p.className,op:getComputedStyle(p).opacity,cfgOpen:window.__EWT.CFG.panelOpen,roots:document.querySelectorAll('.ewt-root').length,panels:document.querySelectorAll('.ewt-panel').length,styleTag:!!st,len:st?st.textContent.length:0};" +
    "try{var rules=Array.from(sheet.cssRules);info.ruleCount=rules.length;info.hasPanelOpen=rules.some(function(r){return r.selectorText==='.ewt-panel.open';});var i=st.textContent.indexOf('.ewt-panel.open');info.ctx=st.textContent.substr(Math.max(0,i-150),300);}catch(e){info.err=e.message;}" +
    "return JSON.stringify(info,null,1);})()"
  );
  console.log('  点击后: ' + dbg2);
  // 面板内容滚动到顶部，保证截图完整
  await win.webContents.executeJavaScript("var p=document.querySelector('.ewt-panel'); if(p) p.scrollTop=0; 1");
  await wait(300);

  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, 'screenshot.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('已保存截图：' + out + ' (' + fs.statSync(out).size + ' bytes)');

  srv.close();
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
