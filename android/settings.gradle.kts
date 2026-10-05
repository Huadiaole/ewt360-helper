// 仓库源策略：
//   默认                                     -> google() + mavenCentral()        （GitHub Actions / 国外网络）
//   GRADLE_MIRROR=aliyun  或  -Dmirror=aliyun -> 阿里云镜像 + mavenCentral()     （国内网络）
//
// 为什么要做成开关：国内直连 maven.google.com 会超时，只能走阿里云；
// 但阿里云对个别 POM 偶发 502，而 Gradle 遇到 5xx 会直接失败（不会自动换下一个源），
// 所以 CI 上必须用官方源。两边各用各的，谁都不受对方拖累。

pluginManagement {
    val cnMirror = (System.getenv("GRADLE_MIRROR") ?: System.getProperty("mirror") ?: "")
        .equals("aliyun", ignoreCase = true)
    repositories {
        if (cnMirror) {
            maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
            maven { url = uri("https://maven.aliyun.com/repository/google") }
        } else {
            gradlePluginPortal()
            google()
        }
        mavenCentral()
    }
}

dependencyResolutionManagement {
    val cnMirror = (System.getenv("GRADLE_MIRROR") ?: System.getProperty("mirror") ?: "")
        .equals("aliyun", ignoreCase = true)
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (cnMirror) {
            maven { url = uri("https://maven.aliyun.com/repository/google") }
        } else {
            google()
        }
        mavenCentral()
    }
}

rootProject.name = "ewt360-helper"
include(":app")
