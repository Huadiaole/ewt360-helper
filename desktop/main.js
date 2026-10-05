'use strict';

/**
 * 升学E网通助手 · 桌面版（Electron 壳）
 * 主进程：窗口 / 菜单 / 会话 / 外链处理
 */

const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME_URL = 'https://web.ewt360.com/site-study/';
const SCRIPT_FILE = path.join(__dirname, 'ewt360-helper.user.js');

const LOG = (...a) => { try { console.log('[host]', ...a); } catch (e) {} };
LOG('main.js loaded | electron=' + process.versions.electron + ' | argv=' + process.argv.join(' '));

/* ==================================================================
 * 受限环境自愈（必须在 app ready 之前做）
 *
 * 症状：双击后毫无反应、没有窗口、进程秒退。
 * 实测（2x2 对照）结论：在受限/沙箱环境里必须同时满足两条才起得来 ——
 *   ① Chromium 沙箱初始化会被拒  -> 需要 --no-sandbox
 *   ② 配置目录不能落在工作区之外  -> 需要把 userData 换到可写且被允许的位置
 * 这里在代码里把两条都办好，这样「双击 exe」和「带参数启动」行为一致。
 * 普通桌面上这两条都无害：沙箱只用于隔离渲染进程，userData 仍优先用程序自带目录。
 * ================================================================== */
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

(function pickWritableUserData() {
  const candidates = [];
  try { candidates.push(path.join(path.dirname(app.getPath('exe')), 'userdata')); } catch (e) {}
  try { candidates.push(path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'EWT360Helper')); } catch (e) {}
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      app.setPath('userData', dir);
      try { app.setPath('sessionData', dir); } catch (e) {}
      LOG('userData -> ' + dir);
      return dir;
    } catch (e) {
      LOG('数据目录不可用: ' + dir + ' (' + (e && e.message) + ')');
    }
  }
  LOG('没找到可写数据目录，用 Electron 默认值');
  return null;
})();


// ---- 关键开关：允许无手势自动播放 + 后台不被节流（挂机连播必需）----
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

let mainWin = null;

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: '升学E网通助手',
    autoHideMenuBar: false,
    backgroundColor: '#f6f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,   // 让 preload 直接跑在主世界，实现 document-start 注入
      nodeIntegration: false,
      sandbox: false,            // preload 需要 require('fs') 读取脚本
      backgroundThrottling: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.setMenu(buildMenu(win));

  // 站内链接新开窗，站外链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/([a-z0-9-]+\.)*ewt360\.com/i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false } } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (e, code, desc, u) => {
    if (code === -3) return; // 用户主动中断
    console.warn('[host] 加载失败', code, desc, u);
  });

  win.webContents.on('render-process-gone', () => {
    dialog.showMessageBox(win, { type: 'warning', message: '渲染进程崩了，正在重新加载…' })
      .then(() => win.reload());
  });

  win.loadURL(url || HOME_URL);
  return win;
}

function buildMenu(win) {
  const send = (js) => () => win.webContents.executeJavaScript(js).catch(() => {});

  return Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '打开课程首页', accelerator: 'CmdOrCtrl+H', click: () => win.loadURL(HOME_URL) },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '助手',
      submenu: [
        {
          label: '一键全开（自动连播+跳题+过检+4倍速）',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: send(`(function(){
            if(!window.__EWT){alert('助手脚本还没加载完，请稍等或刷新页面');return;}
            var C=window.__EWT.CFG;
            C.enabled=true;C.forceSpeed=true;C.autoNext=true;C.autoSkip=true;C.autoCheck=true;C.autoResume=true;C.speed=4;
            window.__EWT.save();window.__EWT.ForceSpeed.apply();
            if(window.__EWT.GUI&&window.__EWT.GUI.root){var b=document.querySelector('.ewt-fab');if(b)b.click();}
            return 'ok';
          })()`)
        },
        {
          label: '暂停全部自动化',
          click: send(`(function(){ if(!window.__EWT) return 'no'; window.__EWT.CFG.enabled=false; window.__EWT.save(); var v=document.querySelector('video'); if(v) v.playbackRate=1; return 'ok'; })()`)
        },
        { type: 'separator' },
        { label: '显示助手面板', click: send(`(function(){var b=document.querySelector('.ewt-fab'); if(b) b.click(); return 1;})()`) },
        { label: '打开倍速上限（改成 32x + 补帧）', click: send(`(function(){ if(!window.__EWT) return 0; var C=window.__EWT.CFG; C.speed=32; C.boostSeek=true; C.forceSpeed=true; C.enabled=true; C.mute=true; window.__EWT.save(); window.__EWT.ForceSpeed.apply(); return 1;})()`) }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '后退', accelerator: 'Alt+Left', click: () => win.webContents.goBack() },
        { label: '前进', accelerator: 'Alt+Right', click: () => win.webContents.goForward() },
        { label: '重新加载', role: 'reload' },
        { label: '强制刷新（忽略缓存）', accelerator: 'CmdOrCtrl+Shift+R', click: () => win.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: '缩放 +', role: 'zoomIn' },
        { label: '缩放 -', role: 'zoomOut' },
        { label: '恢复缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '开发者工具（看 [EWT] 日志）', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
        { label: '全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用说明',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: '使用说明',
            message: '升学E网通助手 · 桌面版',
            detail: [
              '1. 首次打开请先登录学校账号（登录状态会保存在本地）。',
              '2. 右下角 🐋 打开控制面板；默认已开启总开关，4 倍速。',
              '3. 面板里可调倍速（1x~32x）、连播模式、答题策略。',
              '4. 32x 需要开启「超限补帧」，高倍速建议开「静音播放」。',
              '5. 挂机时可最小化窗口，程序已禁用后台节流。',
              '',
              '内置脚本版本：1.0.0'
            ].join('\n')
          })
        },
        { label: '打开脚本源文件所在目录', click: () => shell.showItemInFolder(SCRIPT_FILE) }
      ]
    }
  ]);
}

// 单实例
const gotLock = app.requestSingleInstanceLock();
LOG('singleInstanceLock = ' + gotLock);
if (!gotLock) {
  LOG('已有实例在跑，本进程退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });

  app.whenReady().then(() => {
    LOG('app ready');
    // 允许自动播放（再保险一层，按域名授权）
    try {
      session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        cb(['media', 'fullscreen', 'notifications', 'background-sync', 'autoplay'].includes(permission));
      });
    } catch (e) {}

    try {
      const url = process.argv.find((a) => /^https?:\/\//.test(a));
      LOG('createWindow url=' + url);
      mainWin = createWindow(url);
      LOG('window created');
    } catch (e) {
      LOG('createWindow 失败: ' + (e && e.stack || e));
    }
  }).catch((e) => LOG('whenReady 失败: ' + (e && e.stack || e)));

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow(); });
}
