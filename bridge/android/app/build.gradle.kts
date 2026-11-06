import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Mandarin's own app (android/app in this repository): the driver's sources, its native side and its USB device
// filter are read from there, as driver-files.txt lists them, so what this app plays through is exactly Mandarin's.
// The listed files are put beside this module's sources at build time (build/mandarin), never copied in.
val repo: File = rootDir.resolve("../..")
val mandarin = repo.resolve("android/app/src/main")
val shared = layout.buildDirectory.dir("mandarin").get().asFile
val driverFiles = rootDir.resolve("../driver-files.txt").readLines().map { it.substringBefore('#').trim() }.filter { it.isNotEmpty() }
val mandarinDriver = tasks.register<Sync>("mandarinDriver") {
    description = "Puts Mandarin's driver files (driver-files.txt) beside the app's sources."
    into(shared)
    for (f in driverFiles) from(repo.resolve(f).parentFile) { include(repo.resolve(f).name); into(f.substringBeforeLast('/')) }
}
tasks.named("preBuild") { dependsOn(mandarinDriver) }
// Which Mandarin it was built with: Mandarin's own version, and the commit (CI's), shown on the screen.
val mandarinVersion = Regex("versionName = \"([^\"]+)\"").find(repo.resolve("android/app/build.gradle.kts").readText())?.groupValues?.get(1) ?: "?"
val commit = (System.getenv("GITHUB_SHA") ?: "").take(7).ifEmpty { "local" }

android {
    // The driver's package: its JNI symbols (Java_com_musicd_server_android_UsbDriver_…)
    // and the BuildConfig it reads are Mandarin's. The application id below is
    // this app's own, so it installs beside the Mandarin app.
    namespace = "com.musicd.server.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.musicd.usbdac"
        minSdk = 26
        targetSdk = 36
        // versionCode must rise with every published build or Android refuses
        // to install over the previous one.
        versionCode = 6
        versionName = "0.3.0"
        // 64-bit ARM only, as Mandarin's own native code is: the FiiO R7 and
        // every current Android device.
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_static", "-DMANDARIN_CPP=${mandarin.resolve("cpp").absolutePath}") } }
        buildConfigField("String", "MANDARIN_VERSION", "\"$mandarinVersion at $commit\"")
        // Which build it is (item 291): its commit, as the release's sidecar says the build published (bridge/sidecar.sh).
        buildConfigField("String", "COMMIT", "\"$commit\"")
    }

    // The USB driver's native side (usbdevfs ioctls), from Mandarin's usb_jni.cc.
    ndkVersion = "27.2.12479018"
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    sourceSets.getByName("main") {
        java.srcDir(shared.resolve("android/app/src/main/java"))
        res.srcDir(shared.resolve("android/app/src/main/res"))
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    /*
     * Builds without the release secrets are signed with the key committed
     * beside this file, so every one of them installs over the one before. It
     * is a debug key and public by design: it only makes sideloaded builds
     * update in place. For a key nobody else holds, set the release secrets
     * (see .github/workflows/android.yml).
     */
    signingConfigs.getByName("debug") {
        storeFile = file("mandarin-bridge-debug.keystore")
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
            keyPassword = System.getenv("MUSICD_KEY_PASSWORD") ?: System.getenv("MUSICD_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    lint { checkReleaseBuilds = false }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Mandarin's :core (android/core): the phone protocol, the sign-in, the server client.
    implementation(project(":core"))
    implementation("androidx.core:core:1.13.1")
    // The player: ExoPlayer, with Mandarin's USB sink under it; the same Media3 as Mandarin's app.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-decoder:1.8.0")
    implementation("androidx.media3:media3-extractor:1.8.0")
    // The screen: one Compose page.
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.10.1")
}
