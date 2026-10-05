package com.whale.ewt360

import android.content.res.AssetManager
import android.net.Uri
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.util.Locale

/**
 * 用户脚本装载 + document-start 注入的核心实现。
 *
 * 注入流程：
 *  1. 从 assets 读出 ewt360-helper.user.js（原样拷贝，含 UserScript 元数据块）；
 *  2. 剥掉文件开头的 `// ==UserScript== ... // ==/UserScript==` 块（避免多余解析）；
 *  3. 在前面拼上 `window.__EWT_PRESET={...}`（必须早于用户脚本执行）；
 *  4. 内联进 `<head>` 之后，随 HTML 一起作为 WebResourceResponse 返回。
 */
object UserscriptInjector {

    private const val TAG = "EWT360"

    /** assets 中的用户脚本文件名 */
    const val ASSET_NAME = "ewt360-helper.user.js"

    /** 宿主预设：自动连播 / 跳题 / 过认真度检查 / 4 倍速全部默认打开 */
    const val PRESET_JSON: String =
        "{\"enabled\":true,\"forceSpeed\":true,\"speed\":4,\"autoNext\":true," +
            "\"autoSkip\":true,\"autoCheck\":true,\"autoResume\":true}"

    /** UserScript 元数据块（只在文件开头才会被剥掉） */
    private val META_BLOCK: Regex =
        Regex("""//\s*==UserScript==[\s\S]*?//\s*==/UserScript==[^\r\n]*""")

    @Volatile
    private var cachedBody: String? = null

    // ---------------------------------------------------------------- 域名判定

    /** 只处理 ewt360.com 及其子域 */
    fun isEwtHost(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val h = host.lowercase(Locale.US)
        return h == "ewt360.com" || h.endsWith(".ewt360.com")
    }

    fun isEwtUrl(url: String?): Boolean {
        if (url.isNullOrEmpty()) return false
        val host = try {
            Uri.parse(url).host
        } catch (t: Throwable) {
            null
        }
        return isEwtHost(host)
    }

    // ------------------------------------------------------------ 脚本装载/缓存

    /**
     * 返回可以直接执行的脚本正文：`window.__EWT_PRESET=...;` + 用户脚本。
     * 结果按进程缓存，重复调用只读一次 assets。
     */
    fun scriptBody(assets: AssetManager): String {
        cachedBody?.let { return it }
        synchronized(this) {
            cachedBody?.let { return it }
            val raw = readAsset(assets, ASSET_NAME)
            val stripped = stripMetaBlock(raw).trim()
            // 内联进 <script> 标签时，源码里若出现 </script 会提前闭合标签
            val safe = stripped.replace("</script", "<\\/script")
            val body = "window.__EWT_PRESET=$PRESET_JSON;\n$safe"
            cachedBody = body
            Log.i(TAG, "用户脚本已装载，注入正文 ${body.length} 字符")
            return body
        }
    }

    /** `<script>预设 + 用户脚本</script>` */
    fun inlineScriptTag(assets: AssetManager): String =
        "<script>\n" + scriptBody(assets) + "\n</script>"

    /** 兜底注入用：外层再套一层 __EWT_LOADED__ 守卫，避免重复执行 */
    fun fallbackScript(assets: AssetManager): String {
        val body = scriptBody(assets)
        return "(function(){" +
            "if(window.__EWT_LOADED__)return;" +
            "if(typeof window.__EWT_PRESET==='undefined')window.__EWT_PRESET=$PRESET_JSON;" +
            "try{\n" + body + "\n}catch(e){console.error('[EWT360] fallback inject failed',e);}" +
            "})();"
    }

    // --------------------------------------------------------------- HTML 注入

    /** 在 `<head>` 之后插代码；没有 `<head>` 就插在 `<html>` 之后；都没有就插最前面 */
    fun injectIntoHtml(html: String, snippet: String): String {
        val headIdx = html.indexOf("<head", 0, ignoreCase = true)
        if (headIdx >= 0) {
            val gt = html.indexOf('>', headIdx)
            if (gt >= 0) {
                return html.substring(0, gt + 1) + snippet + html.substring(gt + 1)
            }
        }
        val htmlIdx = html.indexOf("<html", 0, ignoreCase = true)
        if (htmlIdx >= 0) {
            val gt = html.indexOf('>', htmlIdx)
            if (gt >= 0) {
                return html.substring(0, gt + 1) + snippet + html.substring(gt + 1)
            }
        }
        return snippet + html
    }

    // ----------------------------------------------------------------- 拦截入口

    /**
     * 在 [android.webkit.WebViewClient.shouldInterceptRequest] 里调用。
     *
     * 任何异常/非 HTML/非 GET/非 ewt360 域名 —— 一律返回 null，交回 WebView 原生加载。
     */
    fun intercept(
        assets: AssetManager,
        client: OkHttpClient,
        userAgent: String?,
        request: WebResourceRequest
    ): WebResourceResponse? {
        return try {
            val url = request.url?.toString() ?: return null
            if (!isEwtUrl(url)) return null
            if (!"GET".equals(request.method, ignoreCase = true)) return null

            val accept = request.requestHeaders?.get("Accept") ?: ""
            val isDocument = request.isForMainFrame ||
                accept.contains("text/html", ignoreCase = true)
            if (!isDocument) return null

            fetchAndInject(assets, client, userAgent, url)
        } catch (t: Throwable) {
            Log.w(TAG, "拦截注入失败，回退 WebView 原生加载: ${t.message}")
            null
        }
    }

    private fun fetchAndInject(
        assets: AssetManager,
        client: OkHttpClient,
        userAgent: String?,
        url: String
    ): WebResourceResponse? {
        val builder = Request.Builder()
            .url(url)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .get()
        if (!userAgent.isNullOrEmpty()) {
            builder.header("User-Agent", userAgent)
        }

        return client.newCall(builder.build()).execute().use { response ->
            if (response.code != 200) {
                Log.w(TAG, "跳过注入：HTTP ${response.code} $url")
                return null
            }
            val contentType = response.header("Content-Type") ?: ""
            if (contentType.isNotEmpty() && !contentType.contains("html", ignoreCase = true)) {
                return null
            }
            val html = response.body?.string() ?: return null
            if (html.isEmpty()) return null

            val injected = injectIntoHtml(html, inlineScriptTag(assets))

            // 注意：绝不复制原始响应头中的 Content-Encoding / Content-Length，
            // OkHttp 已经透明解压，照抄会让 WebView 把明文当 gzip 解 → 乱码。
            val headers = HashMap<String, String>()
            headers["Content-Type"] = "text/html; charset=utf-8"
            headers["Cache-Control"] = "no-cache, no-store, must-revalidate"

            Log.i(TAG, "已注入用户脚本: $url")
            WebResourceResponse(
                "text/html",
                "utf-8",
                200,
                "OK",
                headers,
                ByteArrayInputStream(injected.toByteArray(Charsets.UTF_8))
            )
        }
    }

    // ------------------------------------------------------------------ 小工具

    private fun readAsset(assets: AssetManager, name: String): String =
        assets.open(name).use { input -> input.readBytes().toString(Charsets.UTF_8) }

    private fun stripMetaBlock(source: String): String {
        val noBom = if (source.startsWith("\uFEFF")) source.substring(1) else source
        val match = META_BLOCK.find(noBom) ?: return noBom
        // 只有位于文件开头（前面全是空白）的元数据块才剥掉
        return if (noBom.substring(0, match.range.first).isBlank()) {
            noBom.removeRange(match.range)
        } else {
            noBom
        }
    }
}
