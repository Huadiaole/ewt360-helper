# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-10-05

首个公开发布版本。

### 功能

- **自动连播**：支持「播完切换」与「85% 切换」两种模式；切集后自动恢复播放；找不到下一节时给出明确提示
- **自动过认真度检查**：精确文字优先 + 按钮类元素约束，避免把弹窗说明文字当按钮点
- **自动跳过 / 作答课中选择题**：优先点「跳过」；没有跳过按钮时按策略选答案后自动提交，支持「智能 / 第一个 / 随机 / 最长」
- **强制倍速**：从 `HTMLMediaElement.prototype` 的 `playbackRate` setter 根部劫持，站点重置无效；支持 0.5x–32x，>16x 时用「超限补帧」越过浏览器原生上限
- **isTrusted 反检测绕过**：劫持 `EventTarget.prototype.addEventListener`，对检测合成点击的监听器注入 Proxy 事件
- **后台保活**：伪造 `document.hidden` / `visibilityState` 并拦截 `visibilitychange` 与 `blur`
- **进度条锁定**：防止误拖动导致学习进度异常
- **美化控制面板**：渐变毛玻璃卡片、可拖动、位置记忆、深色模式自动适配、`Esc` 收起、滑杆调倍速

### 四种形态

- 油猴脚本（Tampermonkey / Violentmonkey）
- MV3 浏览器扩展（Edge / Chrome / Kiwi）
- Electron 桌面版（单文件启动器 + 绿色目录）
- Android 壳工程（Kotlin + WebView，`shouldInterceptRequest` 内联注入实现 document-start）

### 工程

- 离线仿真测试台：8 项冒烟 + 9 项打包版端到端断言
- APK 验收器：零依赖解析 zip 中央目录，比对包内脚本与源文件哈希
- 图标生成器：一张源图生成油猴/扩展/EXE/安卓全部尺寸图标
- CI：自动构建扩展与 APK，打 tag 时发布 Release
