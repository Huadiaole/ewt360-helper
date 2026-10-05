# 升学E网通助手 · 浏览器扩展版（MV3）

同一个助手脚本的第二形态：**Manifest V3 扩展**。适合「不想装 Tampermonkey / 想用手机版 Kiwi 浏览器」的场景。

## 构建

```powershell
node tools\build-extension.mjs
```

零依赖，做两件事：
1. 把 `../ewt360-helper.user.js` 合成 `content.js`（自动剥掉 UserScript 元数据块，并前置一段「全开」预设）；
2. 用内置 PNG 编码器（手写 zlib + CRC32）生成 `icons/icon16|48|128.png`——一只白鲸鱼。

## 桌面：Edge / Chrome 加载

一键（独立配置文件，不污染日常浏览器）：

```powershell
.\start-edge.ps1
```

手动：打开 `edge://extensions`（或 `chrome://extensions`）→ 打开「开发者模式」→ 「加载解压缩的扩展」→ 选 `extension` 目录。

> 扩展用的是 `content_scripts` 的 `"world": "MAIN"` + `"run_at": "document_start"`，需要 Chromium 111+（Edge/Chrome 2023 年以后的版本都满足）。

## 手机：Android 零构建路线（不用 Android Studio）

1. 装 **Kiwi Browser**（Chromium 内核，且支持桌面 Chrome 扩展）；
2. Kiwi 里打开 `chrome://extensions` → 开发者模式 → `Load unpacked`，把整个 `extension` 目录（连同 `icons`）拷进手机存储后选中它；
3. 或退一步：Kiwi / Firefox for Android 装 **Tampermonkey**，直接导入 `ewt360-helper.user.js`。

## 与桌面 EXE 版的差别

| | 扩展版 | Electron EXE 版 |
|---|---|---|
| 安装成本 | 加载一个目录即可 | 下载 ~100MB |
| 注入时机 | `document_start` MG3 MAIN world | preload 主世界 eval（更早） |
| 自动播放 | 受浏览器策略约束，可能需一次点击 | 启动参数已放开，无需点击 |
| 后台挂机 | 切标签可能被节流 | 已禁用节流，最小化照播 |
| 移动端 | ✅ Kiwi 可用 | ❌ Windows only |

## 文件

```
extension/
├─ manifest.json      MV3 清单（all_frames + MAIN world + document_start）
├─ content.js         生成的注入脚本（别手改）
├─ tools/build-extension.mjs   构建器 + PNG 编码器
├─ icons/             由 ../tools/make-icons.ps1 从 docs/icon-source.jpg 生成（16/48/128/256）
├─ start-edge.ps1     一键用独立配置启动 Edge
└─ README.md
```
