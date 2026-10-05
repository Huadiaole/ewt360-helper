# ============================================================
# 升学E网通助手 —— ProGuard / R8 规则
# 目标：WebView 的 JS 注入与 JS 接口全部保留，OkHttp/Okio 不报错
# ============================================================

# 1. 保留所有 @JavascriptInterface 注解的方法（WebView JS 桥）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 2. 保留 JavascriptInterface 注解本身，R8 需要它做判断
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-keepattributes SourceFile,LineNumberTable

# 3. 本 App 自己的类全保留（注入逻辑不能改名）
-keep class com.whale.ewt360.** { *; }
-keepnames class com.whale.ewt360.** { *; }

# 4. WebView 相关：被系统反射调用的类
-keepclassmembers class * extends android.webkit.WebViewClient {
    public *;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public *;
}
-keep class android.webkit.** { *; }
-dontwarn android.webkit.**

# 5. OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# 6. OkHttp 可选依赖（不引入也不报错）
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
