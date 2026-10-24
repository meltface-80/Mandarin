package com.musicd.server.android

import androidx.compose.runtime.mutableStateOf
import com.musicd.server.client.OfflineKind

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
 * Offline (item 109): the screens answered by the phone, Home in this phone's room (not kept: the room chosen is the one
 * the app comes back to). [kind]: why. The screen on show stays where it is (item 117: it used to be closed for Home).
 */
internal fun OfflineNow.goOffline(kind: OfflineKind, phoneZone: String) {
    if (this.kind.value == null) { HomeKept.reset(); ArtistPages.kept.clear() }
    this.kind.value = kind
    NativeShell.zone = phoneZone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to phoneZone
}

/** Online again: the server's answers, Home's rows read afresh, in the room kept ([zone]); the screen on show stays (item 117). */
internal fun OfflineNow.goOnline(zone: String) {
    if (kind.value == null) return
    // What the phone answered isn't kept for the server's (item 157); the Library's wall and the others are kept by
    // which answered them (LibraryWall.state, Walls.state).
    HomeKept.reset()
    ArtistPages.kept.clear()
    kind.value = null
    NativeShell.zone = zone
    NativeShell.homeArgs.value = NativeShell.homeArgs.value.first to zone
}
