package com.whale.ewt360

import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.webkit.WebViewCompat
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 单 Activity 壳：顶部 44dp 工具栏 + 全屏 WebView。
 *
 * 用户脚本通过两条路进入页面：
 *  1. document-start —— WebViewClient.shouldInterceptRequest 用 OkHttp 重新取 HTML，
 *     把脚本内联到 <head> 之后，保证抢在站点脚本前面执行；
 *  2. 兜底 —— onPageStarted / onPageFinished 用 evaluateJavascript 再注入一次，
 *     带 __EWT_LOADED__ 守卫，不会重复跑。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var rootView: FrameLayout
    private lateinit var column: LinearLayout
    private lateinit var webView: WebView

    /** 供 shouldInterceptRequest（非 UI 线程）读取，避免跨线程碰 WebSettings */
    @Volatile
    private var currentUserAgent: String = ""

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(WebViewCookieJar())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val fallbackScript: String by lazy { UserscriptInjector.fallbackScript(assets) }

    // ------------------------------------------------------------------ 生命周期

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        rootView = FrameLayout(this)
        column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        webView = createWebView()

        column.addView(
            createToolbar(),
            LinearLayout.LayoutParams(MP, dp(TOOLBAR_HEIGHT_DP))
        )
        column.addView(webView, LinearLayout.LayoutParams(MP, 0, 1f))
        rootView.addView(column, FrameLayout.LayoutParams(MP, MP))
        setContentView(rootView)

        logWebViewEngine()
        applyUserAgent()
        webView.loadUrl(HOME_URL)
    }

    override fun onDestroy() {
        try {
            exitCustomView()
            column.removeView(webView)
            rootView.removeView(column)
            webView.stopLoading()
            webView.destroy()
        } catch (t: Throwable) {
            Log.w(TAG, "销毁 WebView 异常: ${t.message}")
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ 返回键

    private fun handleBack(): Boolean {
        if (customView != null) {
            exitCustomView()
            return true
        }
        if (webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return false
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && handleBack()) return true
        return super.onKeyDown(keyCode, event)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (!handleBack()) super.onBackPressed()
    }

    // --------------------------------------------------------------------- UI

    private fun createToolbar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(6), 0)
            setBackgroundColor(getColor(R.color.toolbar_bg))
        }

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            setTextColor(getColor(R.color.toolbar_text))
            textSize = 15f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        bar.addView(title, LinearLayout.LayoutParams(0, WC, 1f))

        bar.addView(
            createBarButton(R.string.btn_auto) { onAutoModeClick() },
            barButtonParams()
        )
        bar.addView(
            createBarButton(R.string.btn_reload) { webView.reload() },
            barButtonParams()
        )
        bar.addView(
            createBarButton(R.string.btn_ua) { onToggleUserAgentClick() },
            barButtonParams()
        )
        return bar
    }

    private fun createBarButton(textRes: Int, onClick: () -> Unit): Button =
        Button(this).apply {
            text = getString(textRes)
            textSize = 11f
            // 用显式 setter，避免个别方法没有公开 getter 时 Kotlin 属性语法编译不过
            setAllCaps(false)
            setMinWidth(0)
            setMinimumWidth(0)
            setMinHeight(0)
            setMinimumHeight(0)
            setTextColor(getColor(R.color.toolbar_text))
            setPadding(dp(10), 0, dp(10), 0)
            background = GradientDrawable().apply {
                cornerRadius = dp(6).toFloat()
                setColor(getColor(R.color.whale_accent))
                setStroke(dp(1), getColor(R.color.toolbar_text))
            }
            // 清掉 AppCompat 默认的 backgroundTint，否则绿底会被主题灰化
            backgroundTintList = null
            setOnClickListener { onClick() }
        }

    private fun barButtonParams(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(WC, dp(34)).apply { leftMargin = dp(6) }

    private fun showTopToast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).apply {
            setGravity(Gravity.TOP or Gravity.CENTER_HORIZONTAL, 0, dp(TOOLBAR_HEIGHT_DP + 16))
            show()
        }
    }

    // ---------------------------------------------------------------- WebView 配置

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val view = WebView(this)
        view.setBackgroundColor(Color.WHITE)
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        view.isFocusable = true
        view.isFocusableInTouchMode = true

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            // 关键：没有它 HTML5 <video> 不能自动播放
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, true)
        }

        view.webChromeClient = createChromeClient()
        view.webViewClient = createWebViewClient()
        return view
    }

    private fun createWebViewClient(): WebViewClient = object : WebViewClient() {

        /** document-start 注入：HTML 一落地就把用户脚本塞进 <head> */
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? {
            return UserscriptInjector.intercept(assets, httpClient, currentUserAgent, request)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            injectFallbackScript(view, url)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            injectFallbackScript(view, url)
        }

        /**
         * 拦掉非 http(s) 协议。
         *
         * 站点会用 intent:// 去唤起它的原生 App（里面还嵌着 mistong:// 的 deep link），
         * 裸 WebView 不认这些 scheme，一旦导航过去整页就变成
         * net::ERR_UNKNOWN_URL_SCHEME 错误页 —— 这是「网页无法打开」的根因。
         */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            return handleUrlScheme(request.url?.toString(), request.isForMainFrame)
        }

        @Suppress("DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView, url: String?): Boolean {
            return handleUrlScheme(url, true)
        }

        /** 兜底：万一主框架真的加载了非 http 协议并报错，直接拉回首页，别把用户扔在错误页 */
        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            super.onReceivedError(view, request, error)
            val failing = request.url?.toString() ?: return
            if (request.isForMainFrame && !failing.startsWith("http")) {
                Log.w(TAG, "主框架加载了非 http 协议($failing)，回退到首页")
                view.loadUrl(HOME_URL)
            }
        }
    }

    /**
     * @return true 表示「已经处理掉，WebView 不要再加载这个 URL」
     */
    private fun handleUrlScheme(url: String?, mainFrame: Boolean): Boolean {
        if (url.isNullOrEmpty()) return false
        val scheme = try { Uri.parse(url).scheme?.lowercase() } catch (t: Throwable) { null }
            ?: return false

        if (scheme == "http" || scheme == "https") {
            // 站内链接留在 WebView 里（注入的脚本才能生效）；站外链接交给系统浏览器
            if (mainFrame || UserscriptInjector.isEwtUrl(url)) return false
            return openExternally(url)
        }

        if (scheme == "intent") {
            // 形如 intent://host/path?x=y#Intent;scheme=xx;S.browser_fallback_url=<url>;end
            val fallback = try {
                Uri.parse(url).getQueryParameter("S.browser_fallback_url")
            } catch (t: Throwable) { null }
            if (!fallback.isNullOrEmpty() && fallback.startsWith("http")) {
                Log.i(TAG, "intent:// 带 fallback，改走网页: $fallback")
                webView.loadUrl(fallback)
            } else {
                Log.i(TAG, "已拦掉 intent:// （不去唤起原生 App）")
            }
            return true
        }

        // 只有真正该交给系统的协议才外抛；mistong:/weixin:/alipays: 这类一律静默拦掉，
        // 免得用户正看着网课，突然被拉去装 App。
        if (scheme in setOf("tel", "mailto", "sms", "geo", "market")) {
            openExternally(url)
        } else {
            Log.i(TAG, "已拦掉无法处理的协议: $scheme")
        }
        return true
    }

    private fun openExternally(url: String): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (t: Throwable) {
        Log.w(TAG, "没有能处理该链接的应用: ${t.message}")
        false
    }

    private fun injectFallbackScript(view: WebView, url: String?) {
        if (!UserscriptInjector.isEwtUrl(url)) return
        try {
            view.evaluateJavascript(fallbackScript, null)
        } catch (t: Throwable) {
            Log.w(TAG, "兜底注入失败: ${t.message}")
        }
    }

    private fun createChromeClient(): WebChromeClient = object : WebChromeClient() {

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            Log.d(TAG, "[web:${message.lineNumber()}] ${message.message()}")
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            try {
                request.grant(request.resources)
            } catch (t: Throwable) {
                Log.w(TAG, "授予网页权限失败: ${t.message}")
            }
        }

        // 网页全屏播放（<video> 全屏按钮）
        override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
            if (customView != null) {
                callback.onCustomViewHidden()
                return
            }
            customView = view
            customViewCallback = callback
            column.visibility = View.GONE
            rootView.addView(view, FrameLayout.LayoutParams(MP, MP))
        }

        override fun onHideCustomView() {
            exitCustomView()
        }
    }

    private fun exitCustomView() {
        val view = customView ?: return
        rootView.removeView(view)
        customView = null
        column.visibility = View.VISIBLE
        val callback = customViewCallback
        customViewCallback = null
        try {
            callback?.onCustomViewHidden()
        } catch (t: Throwable) {
            Log.w(TAG, "退出全屏回调异常: ${t.message}")
        }
    }

    // ------------------------------------------------------------------ UA 切换

    private fun applyUserAgent() {
        val desktop = prefs.getBoolean(KEY_DESKTOP_UA, false)
        val ua = if (desktop) DESKTOP_USER_AGENT else cleanWebViewUa(WebSettings.getDefaultUserAgent(this))
        currentUserAgent = ua
        webView.settings.userAgentString = ua
        Log.i(TAG, "当前 UA(桌面=$desktop): $ua")
    }

    /**
     * 去掉系统 UA 里的 `; wv`（WebView 标记）。
     *
     * 站点一看到 wv 就知道自己在「别的 App 的内置浏览器」里，于是立刻走唤起原生 App 的流程
     * （intent:// + mistong://），而裸 WebView 处理不了那个协议 —— 整页就变成错误页。
     * 去掉标记后站点会当成普通手机 Chrome，老老实实渲染网页。
     */
    private fun cleanWebViewUa(raw: String): String = raw
        .replace("; wv)", ")")
        .replace("; wv ", "; ")
        .replace(" wv ", " ")
        .trim()

    private fun onToggleUserAgentClick() {
        val desktop = !prefs.getBoolean(KEY_DESKTOP_UA, false)
        prefs.edit { putBoolean(KEY_DESKTOP_UA, desktop) }
        applyUserAgent()
        webView.reload()
        showTopToast(getString(if (desktop) R.string.toast_ua_desktop else R.string.toast_ua_mobile))
    }

    // ------------------------------------------------------------------ 自动模式

    private fun onAutoModeClick() {
        try {
            webView.evaluateJavascript(AUTO_MODE_JS) { result ->
                val ready = result != null && result.contains("ok")
                showTopToast(getString(if (ready) R.string.toast_auto_on else R.string.toast_auto_wait))
            }
        } catch (t: Throwable) {
            Log.w(TAG, "自动模式调用失败: ${t.message}")
            showTopToast(getString(R.string.toast_auto_wait))
        }
    }

    // -------------------------------------------------------------------- 小工具

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun logWebViewEngine() {
        try {
            val info: PackageInfo? = WebViewCompat.getCurrentWebViewPackage(this)
            Log.i(TAG, "WebView 内核: ${info?.packageName} ${info?.versionName}")
        } catch (t: Throwable) {
            Log.w(TAG, "读取 WebView 内核信息失败: ${t.message}")
        }
    }
}

// ---------------------------------------------------------------------- 常量

private const val TAG = "EWT360"
private const val HOME_URL = "https://www.ewt360.com/"
private const val PREFS_NAME = "ewt360_prefs"
private const val KEY_DESKTOP_UA = "desktop_ua"
private const val TOOLBAR_HEIGHT_DP = 44
private const val DESKTOP_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

private val MP = ViewGroup.LayoutParams.MATCH_PARENT
private val WC = ViewGroup.LayoutParams.WRAP_CONTENT

/**
 * 「自动模式」按钮注入的 JS：
 *  - 更新宿主预设，让下一次整页加载也是全开状态；
 *  - 直接改运行时 window.__EWT.CFG 并保存；
 *  - 顺手把页面里 🐋 面板的开关/倍速显示同步成一致（按 label 文本匹配）。
 */
private val AUTO_MODE_JS: String = """
(function () {
  var preset = window.__EWT_PRESET || {};
  preset.enabled = true;
  preset.forceSpeed = true;
  preset.speed = 4;
  preset.autoNext = true;
  preset.autoSkip = true;
  preset.autoCheck = true;
  preset.autoResume = true;
  window.__EWT_PRESET = preset;

  function syncPanel(cfg) {
    var map = {
      '总开关': 'enabled',
      '强制倍速(锁死)': 'forceSpeed',
      '自动连播': 'autoNext',
      '自动跳过选择题': 'autoSkip',
      '自动过认真度检查': 'autoCheck',
      '防暂停(自动恢复播放)': 'autoResume'
    };
    try {
      var rows = document.querySelectorAll('.ewt-row');
      for (var i = 0; i < rows.length; i++) {
        var label = rows[i].querySelector('label');
        var box = rows[i].querySelector('input[type=checkbox]');
        if (!label || !box) continue;
        var key = map[(label.textContent || '').trim()];
        if (key && Object.prototype.hasOwnProperty.call(cfg, key)) box.checked = !!cfg[key];
      }
      var input = document.querySelector('#ewt-speed-input');
      if (input) input.value = cfg.speed;
      var btns = document.querySelectorAll('.ewt-btns button[data-speed]');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', Number(btns[j].dataset.speed) === Number(cfg.speed));
      }
    } catch (e) {}
  }

  var api = window.__EWT;
  if (!api || !api.CFG) return 'not-ready';

  var cfg = api.CFG;
  cfg.enabled = true;
  cfg.forceSpeed = true;
  cfg.speed = 4;
  cfg.autoNext = true;
  cfg.autoSkip = true;
  cfg.autoCheck = true;
  cfg.autoResume = true;
  try { api.save(); } catch (e) {}
  try { if (api.ForceSpeed && api.ForceSpeed.apply) api.ForceSpeed.apply(); } catch (e) {}
  syncPanel(cfg);
  return 'ok';
})();
""".trimIndent()
