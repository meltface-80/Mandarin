package com.musicd.server.client

/**
 * When "This phone" stops itself (item 124). Paused, Media3 keeps its service in the foreground for ten minutes and
 * then lets it go; with the app off screen, Android then caches the process and freezes it, and the player's media
 * session, still there, is asked something by another app (the lock screen's controls, a watch, the car): Android
 * ends the app for it ("Sync transaction while frozen"), or for the commands' long poll going on in a cached process
 * ("too much CPU"). So, five minutes not playing and off screen, it stops itself first; the app opened again starts it,
 * and the server puts its queue back, paused. Asked every few seconds, with the time from [clock].
 */
class PlayerIdle(private val clock: () -> Long) {
    private var since: Long? = null

    /** True when it should stop now; once said, not again for another five minutes (a car still holding it). */
    fun stop(playing: Boolean, onScreen: Boolean): Boolean {
        val now = clock()
        if (playing) { since = null; return false }
        val from = since ?: now.also { since = it }
        if (onScreen || now - from < STOP_MS) return false
        since = now
        return true
    }

    companion object {
        const val STOP_MS = 5 * 60_000L
    }
}
