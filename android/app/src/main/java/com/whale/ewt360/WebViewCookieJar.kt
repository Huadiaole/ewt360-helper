package com.whale.ewt360

import android.util.Log
import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 把 [CookieManager]（WebView 的 Cookie 仓库）桥接给 OkHttp。
 *
 * 这样 shouldInterceptRequest 里用 OkHttp 重新拉 HTML 时，带上的是同一个登录态，
 * 不会出现「注入版页面掉登录」的问题。
 */
class WebViewCookieJar : CookieJar {

    private val cookieManager: CookieManager
        get() = CookieManager.getInstance()

    // ---------------------------------------------------------------- 写出 Cookie

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val manager = cookieManager
        val target = url.toString()
        for (cookie in cookies) {
            try {
                manager.setCookie(target, toSetCookieString(cookie))
            } catch (t: Throwable) {
                Log.w(TAG, "写入 Cookie 失败: ${cookie.name} (${t.message})")
            }
        }
        try {
            manager.flush()
        } catch (t: Throwable) {
            Log.w(TAG, "flush Cookie 失败: ${t.message}")
        }
    }

    // ---------------------------------------------------------------- 读取 Cookie

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = try {
            cookieManager.getCookie(url.toString())
        } catch (t: Throwable) {
            Log.w(TAG, "读取 Cookie 失败: ${t.message}")
            null
        }
        if (header.isNullOrEmpty()) return emptyList()

        val result = ArrayList<Cookie>()
        for (pair in header.split(';')) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val name = pair.substring(0, eq).trim()
            val value = pair.substring(eq + 1).trim()
            if (name.isEmpty()) continue
            try {
                result.add(
                    Cookie.Builder()
                        .name(name)
                        .value(value)
                        .hostOnlyDomain(url.host)
                        .path("/")
                        .build()
                )
            } catch (t: Throwable) {
                // 非法 cookie 名/值（URL 编码异常等）直接跳过，不影响整次请求
            }
        }
        return result
    }

    // ------------------------------------------------------------------ 小工具

    private fun toSetCookieString(cookie: Cookie): String {
        val sb = StringBuilder(80)
        sb.append(cookie.name).append('=').append(cookie.value)

        val expiresAt = cookie.expiresAt
        if (expiresAt > 0L && expiresAt < Long.MAX_VALUE - 1L) {
            val maxAge = ((expiresAt - System.currentTimeMillis()) / 1000L).coerceAtLeast(0L)
            sb.append("; Max-Age=").append(maxAge)
            sb.append("; Expires=").append(formatExpires(expiresAt))
        }
        if (cookie.domain.isNotEmpty()) {
            sb.append("; Domain=").append(cookie.domain)
        }
        if (cookie.path.isNotEmpty()) {
            sb.append("; Path=").append(cookie.path)
        }
        if (cookie.secure) {
            sb.append("; Secure")
        }
        return sb.toString()
    }

    /** SimpleDateFormat 非线程安全，每次新建一个（Cookie 数量很少，开销可忽略） */
    private fun formatExpires(millis: Long): String {
        val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("GMT")
        return format.format(Date(millis))
    }

    private companion object {
        const val TAG = "EWT360"
    }
}
