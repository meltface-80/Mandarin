package com.musicd.server.client

/*
 * Away for long enough to act on (bug list item 487). A screen opened at home follows this phone's room while away
 * ([RoomFollowed], [AwayRoom]). But "away" is also what the app finds for a moment at home: the Wi-Fi asleep while the
 * screen was off, the app reaches the server over its own Tailscale, and the Wi-Fi is back a second or two after the
 * screen. Acted on at once, Now playing would show the phone's own queue for that moment, a song of hours before where
 * the room at home has another ready (item 485's fault, by another door), and a tap on play would start it. So away
 * counts for the screens once it has stood three seconds with the app on screen; it goes on counting through later
 * looks at the app, until the way is home again.
 */

/** Whether away has stood long enough, on screen, for the screens to act on it. One per run of the app; its caller's thread. */
class AwayStood(private val ms: Long = MS) {
    private var counting = false
    private var from = 0L

    /** Away, and for long enough: the screens follow this phone's room. */
    var stood = false
        private set

    /**
     * The way ([away]) and the screen ([onScreen]) as they are at [now] (ms, a clock that only goes on): how long until
     * this is to be asked again, or null when there is nothing to wait for. Home: not stood, at once. Away and on screen:
     * stood after [ms] of it; off screen the count stops, and starts again with the screen. Once stood, it stays so
     * through the screen's going and coming, until home.
     */
    fun at(away: Boolean, onScreen: Boolean, now: Long): Long? {
        if (!away) { stood = false; counting = false; return null }
        if (stood) return null
        if (!onScreen) { counting = false; return null }
        if (!counting) { counting = true; from = now }
        val left = ms - (now - from)
        if (left > 0) return left
        stood = true; counting = false
        return null
    }

    companion object {
        const val MS = 3_000L
    }
}
