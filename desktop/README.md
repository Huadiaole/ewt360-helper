# 升学E网通助手 · 桌面版（Electron → EXE）

把 `ewt360-helper.user.js` 塞进一个自带 Chromium 的桌面壳。不装 Tampermonkey、不依赖你自己的浏览器。

## ⚠️ 先看这里：双击哪个文件

```
desktop\dist\win-unpacked\
├── 升学E网通助手.exe   ← 双击这个（139 KB 启动器，图标是你的图）
├── app.exe             ← 真正的主程序（172 MB），别直接点它
├── userdata\           ← 自动生成的配置目录（登录状态存这儿）
└── *.dll / *.pak       ← Chromium 运行时，别删
```

**为什么要套一个 139KB 的启动器？**（这是「双击没反应」的根治方案）

实测用 2×2 对照跑出来的结论：在受限/沙箱环境里，Chromium 必须同时满足两条才起得来 ——

| 试的东西 | 结果 |
|---|---|
| 只有 `--no-sandbox` | ❌ 秒退 |
| 只有 `--user-data-dir`（工作区内） | ❌ 秒退 |
| `--no-sandbox` + `--user-data-dir`（工作区**外**） | ❌ 秒退 |
| `--no-sandbox` + `--user-data-dir`（工作区**内**） | ✅ 起窗口，加载出真站点 |

而这两条**没法在 `main.js` 里补**——Chromium 在 JS 跑起来之前就已经把沙箱和配置目录定死了（我试过 `app.commandLine.appendSwitch('no-sandbox')` + `app.setPath('userData', …)`，依然秒退）。
所以改成用 .NET 自带的 `csc.exe` 编了个小启动器，在**命令行层面**把参数带过去，并顺手清掉会捣乱的 `NODE_OPTIONS`。启动器源码：[tools/launcher.cs](desktop/tools/launcher.cs)。

在普通桌面上这些参数也无害，所以无论从哪启动行为都一致。

## 实测验证（不是嘴上说说）

```powershell
cd desktop
$env:NODE_OPTIONS=''
node test/packaged.js     # 零参数启动启动器，让它访问本地仿真页面并回报结果
```

```
=== 打包版 EXE 端到端验证 ===
  ✅ EXE 能启动并加载页面        ✅ 脚本已注入 (window.__EWT)
  ✅ 控制面板已渲染              ✅ 总开关默认已开
  ✅ ① 强制倍速锁死 4x           ✅ ② 自动过检点掉了「点击通过检查」
  ✅ ③ 自动跳题点掉了「跳过」     ✅ ④ 自动连播切到了第 2 节
  ✅ ⑤ isTrusted 校验被绕过            通过 9/9
```

另外实测：双击启动器不带任何参数，主程序窗口标题 = `升学e网通-高中生在线学习一站式平台`（真站点加载成功），`userdata\` 自动建在程序旁边。

## 为什么比 Tampermonkey 更强

| 维度 | Tampermonkey | 本桌面版 |
|---|---|---|
| 注入时机 | document-start | **preload 主世界 eval**，比页面任何脚本都早 |
| 自动播放 | 受自动播放策略限制，常要手点 | 启动参数 `--autoplay-policy=no-user-gesture-required`，**开门就播** |
| 后台挂机 | 切标签会被节流 | `backgroundThrottling:false` + 关闭遮挡计算，**最小化也照播** |
| 多开 | 要多个浏览器配置 | 每个进程独立 |

## 重新打包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-exe.ps1
```

脚本七步：同步脚本 → 配环境（缓存本地化 + 国内镜像 + 清 NODE_OPTIONS）→ 装依赖 → **杀残留进程**（否则旧目录删不掉，打包必失败）→ 打包 dir → **主程序改名 + 编译启动器** → rcedit 刻图标/版本。

> ⚠️ 必须带 `-ExecutionPolicy Bypass`（脚本没签名）。
> ⚠️ 脚本是 UTF-8 **带 BOM** 的，用编辑器改完别丢 BOM，否则 Windows PowerShell 5.1 按 GBK 读会报语法错。
> ⚠️ 启动器源码 `tools/launcher.cs` 也必须带 BOM，否则 csc 按 ANSI 码页读，中文提示会乱码。

## 已知环境坑（都已在脚本/启动器里解决）

| 现象 | 原因 | 处理 |
|---|---|---|
| `electron: --use-system-ca is not allowed in NODE_OPTIONS` | 本机全局 NODE_OPTIONS 干扰 | 启动器里把 NODE_OPTIONS 从子进程环境删掉 |
| **双击毫无反应、没窗口、进程秒退** | 受限环境：沙箱初始化被拒 + 配置目录不能落在外 | 启动器带 `--no-sandbox` + `--user-data-dir`（见上面 2×2 表） |
| 打包报 `remove ...ffmpeg.dll: Access is denied` | 上一次的进程还活着锁着 dll | 脚本第 4 步先杀残留进程；实在杀不掉就换个输出目录重打 |
| `Cannot create symbolic link ... libcrypto.dylib` | electron-builder 解压 winCodeSign 要建 macOS 符号链接 | 已手工解压到 `.electron-builder-cache\winCodeSign-2.6.0`，并关掉 `signAndEditExecutable` |
| `Internal compiler error #12345: error creating mmap` | 本环境 makensis 无法 mmap（用 87MB 极简 .nsi 单测复现过，与 OneDrive/磁盘/沙箱路径无关） | 单文件 portable 版在本机打不出来，降级绿色目录版；普通 Windows 上通常能出 |

## 本地调试

```powershell
$env:NODE_OPTIONS = ''      # 必须
npm start                   # = electron --no-sandbox .
npm test                    # = electron --no-sandbox test/smoke.js（8 项冒烟）
```

## 使用时怎么点

1. 双击 `升学E网通助手.exe`（启动器）→ 窗口打开即进入 `web.ewt360.com/site-study/`；
2. 第一次先登录学校账号（登录态存在 `userdata\` 里，与你日常浏览器互不影响）；
3. 默认已 **总开关 ON / 4 倍速 / 自动连播 / 自动跳题 / 自动过检**；
4. 右下角 🐋 打开面板细调；菜单栏「助手」里 `Ctrl+Shift+A` 一键全开、32x 补帧、暂停全部自动化。

## 常见问题

**Q：双击后窗口一闪就没了？** 确认点的是 `升学E网通助手.exe`（139KB 那个）而不是 `app.exe`。还不行就跑一次 `pwsh -File test\packaged.js` 看日志。

**Q：面板没出现？** `F12` 看 Console 有没有 `[EWT] 升学E网通助手 已启动`。

**Q：32x 没效果？** 浏览器原生上限 16x，超出部分靠「超限补帧」每 500ms 往前跳时间，必须在面板里打开它。

**Q：杀毒报毒？** Electron 打包的 exe 常被启发式误报，加白名单即可。

**Q：`dist\` 目录删不掉？** 里面有个残留进程（`app.exe` 或 `升学E网通助手.exe`）锁着 `ffmpeg.dll`。任务管理器结束它，或重启后删除。
