package com.musicd.server.android

import androidx.compose.runtime.mutableStateOf
import com.musicd.server.client.OfflineKind
import com.musicd.server.client.ShellRoute

/**
 * Whether the app is offline now (bug list item 109, O1 in docs/specs/plan-android-native.md): null online; [OfflineKind.MODE]
 * Offline mode switched on; [OfflineKind.APP] the server can't be reached. Set by MainActivity as it finds out, through
 * [NativeShell.goOffline] and [NativeShell.goOnline]; the native screens are then answered by the phone ([Store.screenClient]).
 */
internal object OfflineNow {
    val kind = mutableStateOf<OfflineKind?>(null)
    val on: Boolean get() = kind.value != null
}

/**
 * Offline (item 109): the native screens answered by the phone, the native Home in front in this phone's room; the page,
 * parked, is never asked. [kind]: why.
 */
internal fun OfflineNow.goOffline(kind: OfflineKind, phoneZone: String) {
    val was = this.kind.value
    if (was == null) HomeKept.reset()
    this.kind.value = kind
    NativeShell.menuOpen.value = false
    NativeShell.told = true
    NativeShell.pageFront.value = false
    NativeShell.zone = phoneZone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to phoneZone
    if (was != null) return
    val n = NativeShell.nav ?: return
    n.popBackStack(ShellRoute.WEB, false)
    n.navigate(ShellRoute.home(NativeShell.homeArgs.value.first, phoneZone)) { launchSingleTop = true }
}

/** Online again: the server's answers, Home's rows read afresh; the page, loading again underneath, says where Home stands. */
internal fun OfflineNow.goOnline(zone: String) {
    if (kind.value == null) return
    HomeKept.reset()
    kind.value = null
    NativeShell.zone = zone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to zone
    NativeShell.nav?.let { n -> if (!n.popBackStack(ShellRoute.HOME, false)) n.navigate(ShellRoute.home(NativeShell.homeArgs.value.first, zone)) { launchSingleTop = true } }
}

/**
 * What a native screen hands to the page, offline (item 109): the row's buttons are the app's own (Home, the Library wall,
 * the side menu, the search); the page's sheets and screens, which need the server, are not there to open.
 */
internal fun OfflineNow.toPage(what: String, arg: String?) {
    val n = NativeShell.nav ?: return
    if (what != "nav") return
    when (arg) {
        "home" -> { n.popBackStack(ShellRoute.HOME, false); HomeKept.toTop = true }
        "library" -> n.navigate(ShellRoute.library(NativeShell.libraryView, NativeShell.prefs.orEmpty(), NativeShell.zone)) { launchSingleTop = true }
        "menu" -> NativeShell.menuOpen.value = true
        "search" -> NativeShell.openSearch("", NativeShell.zone)
    }
}
