package com.musicd.server.android

import androidx.compose.runtime.mutableStateOf
import com.musicd.server.client.OfflineKind
import com.musicd.server.client.ShellRoute

/**
 * Whether the app is offline now (bug list item 109, O1 in old/plan-android-native.md): null online; [OfflineKind.MODE]
 * Offline mode switched on; [OfflineKind.APP] the server can't be reached. Set as ServerReach finds out, through
 * [goOffline] and [goOnline]; the screens are then answered by the phone ([Store.screenClient]).
 */
internal object OfflineNow {
    val kind = mutableStateOf<OfflineKind?>(null)
    val on: Boolean get() = kind.value != null
}

/**
 * Offline (item 109): the screens answered by the phone, Home in front in this phone's room (not kept: the room chosen
 * is the one the app comes back to). [kind]: why.
 */
internal fun OfflineNow.goOffline(kind: OfflineKind, phoneZone: String) {
    val was = this.kind.value
    if (was == null) HomeKept.reset()
    this.kind.value = kind
    NativeShell.menuOpen.value = false
    NativeShell.zone = phoneZone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to phoneZone
    if (was == null) NativeShell.nav?.popBackStack(ShellRoute.HOME, false)
}

/** Online again: the server's answers, Home's rows read afresh, in the room kept ([zone]). */
internal fun OfflineNow.goOnline(zone: String) {
    if (kind.value == null) return
    HomeKept.reset()
    kind.value = null
    NativeShell.zone = zone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to zone
    NativeShell.nav?.popBackStack(ShellRoute.HOME, false)
}
