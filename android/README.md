# 升学E网通助手 · Android 壳工程

> ## ✅ 已经编译成功（不用你动手了）
>
> APK 产物：`dist\EWT360-Helper-1.0.0-debug.apk`（4.73 MB，debug 签名，可直接装手机）
>
> 验收结果（`node tools\inspect-apk.mjs`）：
> - 包名 `com.whale.ewt360` / versionCode 1 / versionName 1.0.0 / minSdk 24 / targetSdk 34
> - `assets/ewt360-helper.user.js` 与仓库源文件 **SHA256 完全一致**（`9a4e057f…`）
> - 15 张图标 + 2 个自适应图标 XML 全部打进包
> - `apksigner verify` 通过（Android Debug 证书）
>
> **想重新编译**：工具链已装在 `C:\dsh-android`（JDK 17 + SDK 34 + Gradle 8.7），执行
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-apk.ps1
> ```
> 脚本会自动设环境变量 → 复制到短路径 `C:\dsh-android\work`（避开中文路径与 MAX_PATH）→ 写 `local.properties` → `gradle assembleDebug` → 把 APK 收进 `dist\`。

把 Tampermonkey 用户脚本 `ewt360-helper.user.js` 注入 WebView 的安卓外壳。
包名 `com.whale.ewt360`，App 名「升学E网通助手」。

功能（全部来自用户脚本，壳只负责「让脚本在 document-start 就跑起来」）：

- 自动连播（播完切换 / 85% 切换）
- 自动过「认真度检查」
- 自动跳过（或作答）课中选择题
- 强制倍速（默认 4x，可超过站点上限）
- 切集后 / 被暂停时自动恢复播放
- 页面右下角 🐋 悬浮面板，可手动微调所有开关

---

## 1. 目录结构

```
android/
├── settings.gradle.kts                      仓库与模块声明
├── build.gradle.kts                         根构建脚本（AGP 8.5.2 + Kotlin 1.9.24）
├── gradle.properties                        useAndroidX / jvmargs / nonTransitiveRClass
├── gradle/wrapper/gradle-wrapper.properties distributionUrl = gradle-8.7-bin.zip
├── .gitignore
├── README.md
└── app/
    ├── build.gradle.kts                     模块配置（compileSdk 34 / minSdk 24 / targetSdk 34）
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── assets/ewt360-helper.user.js     用户脚本原文（与仓库根目录同名文件逐字节一致）
        ├── java/com/whale/ewt360/
        │   ├── MainActivity.kt              单 Activity：工具栏 + WebView + 返回键 + UA 切换
        │   ├── UserscriptInjector.kt        脚本装载 / <head> 注入 / OkHttp 代拉 HTML
        │   └── WebViewCookieJar.kt          OkHttp <-> android.webkit.CookieManager 桥
        └── res/
            ├── values/strings.xml            app_name 等文案
            ├── values/colors.xml
            ├── values/themes.xml             Theme.EWT360（派生自 Theme.AppCompat.NoActionBar）
            ├── mipmap-anydpi-v26/ic_launcher.xml     自适应图标（API 26+，前景用位图）
            ├── mipmap-anydpi-v26/ic_launcher_round.xml
            └── mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/
                ├── ic_launcher.png                   方形图标（API 24/25 及老启动器）
                ├── ic_launcher_round.png             圆形图标（透明角）
                └── ic_launcher_foreground.png        自适应前景（108dp 画布 / 内容 78% 安全区）

> 图标由仓库根的 `tools/make-icons.ps1` 从 `docs/icon-source.jpg` 统一生成：
> ```
> powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-icons.ps1
> ```
```

> 说明：**没有** `gradlew` / `gradlew.bat` / `gradle-wrapper.jar`。
> 仓库里不塞伪造的二进制 jar，生成方法见第 3 节。

---

## 2. 用 Android Studio 打开

1. 装 **Android Studio Koala (2024.1) 或更新版本**（自带 JDK 17）。
2. `File → Open…`，选中 `android` 文件夹（**不要**选它的父目录）。
3. 第一次打开会提示缺少 Gradle Wrapper —— 按提示点 **「OK / Use gradle wrapper」**，
   Android Studio 会自动补出 `gradlew`、`gradlew.bat`、`gradle/wrapper/gradle-wrapper.jar`，然后开始同步。
4. 若提示缺 SDK：`Tools → SDK Manager` 勾上
   - **Android SDK Platform 34**
   - **Android SDK Build-Tools 34.0.0**
   - **Android SDK Platform-Tools**
5. `Build → Build Bundle(s) / APK(s) → Build APK(s)`。
6. 产物：`app/build/outputs/apk/debug/app-debug.apk`（AS 里点「locate」直接定位）。

---

## 3. 命令行构建

前置：**JDK 17** + **Android SDK（Platform 34 + Build-Tools 34.0.0）**。

> **仓库源开关**（重要）
> 默认使用 `google()` + `mavenCentral()`，适合 GitHub Actions 与国外网络。
> 国内直连 `maven.google.com` 会**超时**，请加开关走阿里云镜像：
> ```bash
> GRADLE_MIRROR=aliyun gradle assembleDebug      # 环境变量
> gradle assembleDebug -Dmirror=aliyun           # 或系统属性
> ```
> 反过来，如果镜像对某个 POM 返回 5xx，Gradle 会直接失败（不会自动换源），所以 CI 上必须用官方源。

若本机没装 Android SDK，先装（任选其一）：

- Android Studio 自带 SDK Manager（最省事）；
- 命令行 `sdkmanager`：
  ```bash
  sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
  ```

在工程根目录写 `local.properties`（该文件已被 `.gitignore` 忽略，**不要**提交）：

```properties
# Windows 注意：反斜杠要写成双写
sdk.dir=C\:\\Users\\你的用户名\\AppData\\Local\\Android\\Sdk
```

**先生成 wrapper**（本工程故意不带 jar，二者选一）：

```bash
# 方案 A：本机装了 Gradle 8.x，直接在工程根目录执行
gradle wrapper --gradle-version 8.7

# 方案 B：完全没装 Gradle —— 直接用已下载的 gradle-8.7 解压包里的 bin/gradle(.bat)
#           执行上面同一条命令即可
```

然后构建：

```bash
# Windows
gradlew.bat assembleDebug

# macOS / Linux
./gradlew assembleDebug

# 安装到已连接的设备
gradlew.bat installDebug
```

APK 输出路径：

```
app/build/outputs/apk/debug/app-debug.apk
```

其他常用任务：`assembleRelease`（未签名）、`clean`、`lint`。

---

## 4. 不想编译？三条零构建路线

脚本本身是**纯 JS、零依赖**的，只要能装 Tampermonkey，就不需要这个 APK。

### ① Kiwi Browser（Chromium 内核，支持 Chrome 扩展）— 最省事

1. Play 商店 / 官网装 **Kiwi Browser**；
2. 在 Kiwi 里打开 Chrome 应用商店，装 **Tampermonkey**；
3. 把 `ewt360-helper.user.js` 传到手机，用文件管理器打开 → 选 Tampermonkey → 安装；
   （或者在 Kiwi 地址栏输入 `tampermonkey://` → 点「实用工具 → 导入」）
4. 打开 `https://www.ewt360.com/`，右下角出现 🐋 就成功了；
5. 想要「强制倍速 / 后台保活」这类更激进的开关，点 🐋 面板里手动开。

### ② Firefox for Android + Tampermonkey

1. 装 **Firefox for Android**（注意：新版 Firefox 需要装扩展列表里的 Tampermonkey）；
2. `菜单 → 扩展` 安装 Tampermonkey；
3. 访问 `ewt360-helper.user.js` 的地址（本机 `file://` 或你托管的 URL），Tampermonkey 会弹出安装页；
4. 同样打开网站验证 🐋 面板。

> 相对 Kiwi 的差别：Firefox 的 `document-start` 时机略晚，少数情况下注入会晚于站点脚本，
> 「强制倍速锁死」可能需要在面板里点一次才生效。

### ③ 已有第三方 WebView 注入类 App

- 各类「用户脚本管理器 / JS 注入浏览器」（如支持 `@match` + `@run-at document-start` 的壳浏览器）；
- 直接把 `ewt360-helper.user.js` 丢进它的脚本目录，或粘进「自定义 JS」输入框；
- 唯一硬性要求：**注入时机是 `document-start`**（DOM 还没建就开始跑），否则倍速劫持会晚一步。

---

## 5. 注入原理（壳为什么能抢到 document-start）

`shouldInterceptRequest(view, request)` 在 WebView 每次发请求时被调用，运行在**工作线程**，
可以同步阻塞地拿网络数据：

1. 只处理 host 以 `.ewt360.com` 结尾的请求；
2. 只处理文档请求（`request.isForMainFrame` 为 true，或请求头 `Accept` 含 `text/html`）；
3. 用 OkHttp 带 Cookie（`WebViewCookieJar` 桥接 `android.webkit.CookieManager`）**重新**请求该 URL；
4. 拿到 200 + HTML 后，把 `<script>window.__EWT_PRESET={...}; <用户脚本></script>`
   插到 `<head>` 之后（没有 `<head>` → 插 `<html>` 之后；都没有 → 插最前面）；
5. 返回新的 `WebResourceResponse("text/html", "utf-8", 200, "OK", headers, stream)`。

关键细节：

- **绝不**复制原始响应头里的 `Content-Encoding` / `Content-Length`：OkHttp 已经透明解压，
  照抄会让 WebView 把明文当 gzip 解 → 满屏乱码；
- 任何异常都 `return null`，交回 WebView 原生加载，最多退化成「兜底注入」；
- 用户脚本开头的 `// ==UserScript== … // ==/UserScript==` 块在 Kotlin 侧用正则剥掉；
- 源码里若出现 `</script` 会被转义成 `<\/script`，防止 HTML 提前闭合；
- 兜底：`onPageStarted` / `onPageFinished` 用 `evaluateJavascript` 再注入一次全量脚本，
  外层包 `if(!window.__EWT_LOADED__){…}`（脚本内部还有一层同名守卫），重复执行无副作用。

---

## 6. 工具栏三个按钮

| 按钮 | 行为 |
| --- | --- |
| **自动模式** | `evaluateJavascript` 调 `window.__EWT`，把 `enabled / forceSpeed / autoNext / autoSkip / autoCheck / autoResume` 全开、`speed=4`，存进 localStorage，并把页面 🐋 面板的开关同步成一致；顶部 Toast 反馈。脚本没就绪时会提示「等页面加载完成后再点一次」。 |
| **重载** | `WebView.reload()`。 |
| **UC/PC UA 切换** | 在「默认 UA（手机）」和「桌面 Chrome 126 UA」之间切换并 reload，选择记在 `SharedPreferences`（`ewt360_prefs` / `desktop_ua`）。桌面 UA 会拿到 PC 版页面。 |

UA 常量：

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
```

> ⚠️ 关于预设的一个坑（脚本自身的设计）：`window.__EWT_PRESET` 只改**默认值**，
> 用户脚本随后会用 `localStorage['ewt_helper_cfg']` 覆盖它（「设置自动保存」）。
> 也就是说——如果你之前用右下角 🐋 面板手动关过某个开关，重装 / 重开 App 后那个「关」会被记住，
> 预设不会把它顶回来。此时点一下工具栏的 **自动模式** 就会全开并重新写回 localStorage。

---

## 7. WebView 关键配置（都在 `MainActivity.createWebView()`）

| 配置 | 值 | 为什么 |
| --- | --- | --- |
| `javaScriptEnabled` | true | 脚本靠它跑 |
| `domStorageEnabled` / `databaseEnabled` | true | 脚本用 localStorage 存配置 |
| `mediaPlaybackRequiresUserGesture` | **false** | 不开这个 `<video>` 不会自动播放，整个 App 就废了 |
| `setSupportMultipleWindows` | false | 弹窗留在本 WebView |
| `mixedContentMode` | `MIXED_CONTENT_ALWAYS_ALLOW` | 页面里混用的 http 资源不被拦 |
| `CookieManager.setAcceptThirdPartyCookies` | true | 第三方 iframe 里的播放器要靠它维持登录态 |
| `allowFileAccess` / `allowContentAccess` | false | 不需要读本地文件，收紧一点 |
| 硬件加速 | Manifest `android:hardwareAccelerated="true"` + `LAYER_TYPE_HARDWARE` | 4x/8x 播放不卡 |
| `configChanges` | `orientation\|screenSize\|keyboardHidden` | 横竖屏切换不重建 Activity，视频不被打断 |

另外：`WebChromeClient.onShowCustomView / onHideCustomView` 支持网页内 `<video>` 全屏播放；
`FLAG_KEEP_SCREEN_ON` 防止看视频时息屏；返回键优先 `webView.goBack()`，退不动才退出。

---

## 8. 调试

- 日志 TAG 统一是 `EWT360`：`adb logcat -s EWT360` 看注入是否成功（正常会有
  `用户脚本已装载，注入正文 N 字符` → `已注入用户脚本: <url>`）；
- 网页自己的 `console.log` 也会以 `[web:<行号>]` 转发到 logcat（脚本日志前缀是 `[EWT]`）；
- 想确认注入时机：页面右键检查不可用，直接在 🐋 面板里看「状态」行；
- 换 UA 后页面结构会变（PC / 手机版），脚本对 PC 版页面的适配不如手机版好，首选默认 UA。

---

## 9. 已知限制

- 用户脚本更新后，需要重新 `Copy-Item` 覆盖 `app/src/main/assets/ewt360-helper.user.js` 并重新打包；
  APK 内是**拷贝**，不会跟着源文件自动更新。
- 站点若把播放器放在**第三方域**的 iframe 里（host 不是 `.ewt360.com`），那个 iframe 的 HTML 不会被替换，
  脚本也就注入不进去；这种情况下只能等站点自己把播放器放回主域，或改用第 4 节的浏览器插件路线
  （Tampermonkey 的 `@match` 同样受同源限制，但脚本管理器能对子域生效，覆盖面更宽）。
- 站点若下发 `Content-Security-Policy` 且禁止内联脚本，注入会被浏览器拦下 —— 当前实现返回的是
  自己构造的响应（不含原 CSP 响应头），但页面 `<meta http-equiv="Content-Security-Policy">` 仍可能生效。
- 高倍速（>16x）需要脚本里开「超限补帧」，且安卓端解码能力有限，8x 以上容易音画不同步。

## 10. 签名说明（重要）

仓库内置了一份固定签名密钥：`android/keystore/debug.keystore`
（alias `androiddebugkey`，口令 `android`，
SHA-256 指纹 `9EA3C79124EB783485BDF26998EDC86F8E35D2A7EEDCF83A484311E00D83E628`）。

**为什么把它放仓库里**：GitHub Actions 每次跑都是全新机器，默认 debug 密钥是随机生成的。
不固定下来就会出现「每次发布的 APK 签名都不一样 → 升级必须先卸载、登录状态全丢」。
内置固定密钥后，本地与 CI 产物签名一致，可以正常覆盖安装。

**注意**：这是 debug 级签名（口令公开，任何人都能重新签），**不能用于上架应用商店**。
要发正式版请自己用 `keytool` 生成 release 密钥，存进 GitHub Secrets，并改成从环境变量读取。
