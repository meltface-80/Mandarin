pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MandarinBridge"
// Mandarin's :core module, as it is in this repository (android/core): the phone
// protocol, the sign-in and the server client the app talks with.
include(":core")
project(":core").projectDir = file("../../android/core")
include(":app")
