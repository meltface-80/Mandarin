package com.musicd.server.client

/*
 * Offline, in the page's words (server-notice.js, OFFLINE_WHY and openOffline; bug list item 105, the first of O1 in
 * docs/specs/plan-android-native.md): why the app is showing only the music on this phone, said when the row's Offline
 * sign is tapped. The page's "unreachable" is a browser's; the app is either offline by choice or answering for a server
 * it can't reach.
 */

/** Why the app shows only the phone's music: [MODE], Offline mode switched on; [APP], the server can't be reached. */
enum class OfflineKind { MODE, APP }

object OfflineNote {
    /** The dialog's heading. */
    fun title(kind: OfflineKind): String = if (kind == OfflineKind.MODE) "Offline mode is on" else "Mandarin can’t be reached"

    /** What it says, a paragraph each. */
    fun lines(kind: OfflineKind): List<String> = if (kind == OfflineKind.MODE) MODE else APP

    /** Offline mode is the app's own switch, which it alone turns off: the dialog offers it only then. */
    fun canSwitch(kind: OfflineKind): Boolean = kind == OfflineKind.MODE

    private val MODE = listOf(
        "You switched Offline mode on, so Mandarin is showing only the music on this phone: the albums you downloaded and the phone’s own music.",
        "Switch it off to see the server’s library again.")
    private val APP = listOf(
        "This phone can’t reach the Mandarin server, so the app is showing the music on this phone: the albums you downloaded and the phone’s own music.",
        "It keeps trying, and the server’s library comes back by itself as soon as the server answers.",
        "If it doesn’t: check the server is running, and that this phone is on the same network as it — or, away from home, that it can reach the server through Tailscale.")
}
