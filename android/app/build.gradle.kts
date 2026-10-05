plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.whale.ewt360"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.whale.ewt360"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "1.0.2"

        // assets 里的用户脚本不要被压缩工具改写
        androidResources {
            noCompress += "js"
        }
    }

    /**
     * 固定签名密钥（仓库内置，公开无妨）。
     *
     * 为什么需要它：GitHub Actions 每次都是一台全新的机器，默认 debug 密钥是随机生成的，
     * 于是每次 CI 产出的 APK 签名都不一样 —— 用户装新版时必须先卸载旧版，连登录状态都会丢。
     * 内置一份固定密钥后，所有构建（本地 / CI / 以后）签名一致，可以覆盖安装、无痛升级。
     *
     * 注意：这只是 debug 级签名，不能用于上架应用商店；要发正式版请换成自己的 release 密钥。
     */
    signingConfigs {
        create("stable") {
            storeFile = file("../keystore/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("stable")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("stable")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = false
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        resources.excludes += "/META-INF/DEPENDENCIES"
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
