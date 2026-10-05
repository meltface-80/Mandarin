import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.musicd.server.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.musicd.server.remote"
        minSdk = 26
        targetSdk = 36
        // versionCode must rise with every published build or Android refuses
        // to install over the previous one.
        versionCode = 132
        versionName = "0.6.22"
        // The Tailscale engine (jniLibs) is built for 64-bit ARM only, and so
        // is the native code below: one ABI, every phone the app runs on.
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_static") } }
    }

    /*
     * Native code: Media3's Opus decoder over libopus (src/main/cpp), so the
     * server's Opus 256 is decoded to float rather than Android's 16-bit —
     * 24/48 into the phone's audio path. CMake fetches libopus itself; the
     * NDK and CMake come from the SDK manager (the workflow installs them).
     */
    ndkVersion = "27.2.12479018"
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    buildFeatures {
        buildConfig = true
    }

    /*
     * The release key comes from the environment (a CI secret); without it the
     * release build is signed with the committed key below (see buildTypes),
     * and the workflow names that APK "-shared-key". Android refuses to install an APK over one signed with a different key,
     * so it must be the same key every time.
     */
    /*
     * Builds without the release secrets are signed with THIS key, committed
     * beside this file, so every one of them can update the one before —
     * a fresh debug key per CI run is what made updates fail ("an existing
     * package conflicts"). It is a debug key and public by design, like
     * Android's own: it only makes sideloaded builds update in place. For a
     * key nobody else holds, set the release secrets (see the workflow).
     */
    signingConfigs.getByName("debug") {
        storeFile = file("musicd-debug.keystore")
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }

    val keystorePath = System.getenv("MUSICD_KEYSTORE")
    if (!keystorePath.isNullOrBlank()) {
        signingConfigs.create("release") {
            storeFile = file(keystorePath)
            storePassword = System.getenv("MUSICD_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("MUSICD_KEY_ALIAS") ?: "musicd"
            keyPassword = System.getenv("MUSICD_KEY_PASSWORD")
                ?: System.getenv("MUSICD_KEYSTORE_PASSWORD")
        }
    }

    /*
     * Every published build is a RELEASE build (v0.6.10): optimised Kotlin,
     * the native Opus decoder compiled with optimisation, not debuggable.
     * Before, a CI run without the release secrets built the debug variant,
     * which Android runs noticeably slower (the app's start, its own audio
     * path, libopus at -O0). Without the secrets the release build is signed
     * with the committed key above — the one every earlier build used — so it
     * still installs over them in place.
     */
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    // A release build also runs Android's "lint vital" checks, which can stop
    // the build over warnings the debug builds never had to pass; they don't
    // change what's built, and CI's own tests stand for the app's behaviour.
    lint { checkReleaseBuilds = false }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // The Tailscale engine (android/musicdnet, built by CI into
        // src/main/jniLibs) is a program the app runs, so it must be unpacked
        // onto the phone — Android only lets apps run files from there.
        jniLibs.useLegacyPackaging = true
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*"
        )
    }
}

/*
 * MusicD's interface, built into the app: this version's public/ files, for
 * the offline page until the app has saved a copy from the server (see
 * OfflineSite). So offline is always the same MusicD interface.
 */
val bundleSite = tasks.register<Copy>("bundleSite") {
    from(rootProject.file("../public")) {
        include("index.html", "app.js", "style.css", "android.css", "sharecard.js", "srp.js", "biquad.js", "manifest.json",
            "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon.ico",
            "fonts/manrope.woff2", "fonts/young-serif.woff2")
    }
    into(layout.buildDirectory.dir("generated/site/site"))
}
android.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/site"))
tasks.named("preBuild") { dependsOn(bundleSite) }

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Everything that is not Android — the address rules, the API client, the
    // network search — lives in :core, where it is unit-tested on a plain JVM.
    implementation(project(":core"))
    // FileProvider only: a share card leaves the app as a content:// URI.
    implementation("androidx.core:core:1.13.1")
    // "This phone": playback (ExoPlayer) and the media session, notification
    // and lock-screen controls that come with it.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    // The Opus decoder module carried in src/main/java/androidx/media3/decoder/opus
    // builds on Media3's decoder base classes.
    implementation("androidx.media3:media3-decoder:1.8.0")
    implementation("androidx.media3:media3-extractor:1.8.0")
    implementation("androidx.media3:media3-session:1.8.0")
    // The cache of tracks played on the phone keeps its index in a database.
    implementation("androidx.media3:media3-database:1.8.0")
    // Downloads: queued, retried and resumed, waiting for Wi-Fi if asked to.
    implementation("androidx.work:work-runtime:2.10.3")
    // The page stays on one address at home and away (PageRelay): the WebView's
    // traffic for the server goes through the app's relay.
    implementation("androidx.webkit:webkit:1.12.1")
}
