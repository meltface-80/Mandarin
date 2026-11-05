package com.musicd.server.client

import org.json.JSONObject

/**
 * Which albums the server has, as it marks them (/api/library/mark, v0.8.43), followed while the app is on screen
 * (bug list item 232): the Library wall and Home's Library row read their albums again when it moves, so an album
 * copied into a watched folder is on the wall sorted by Recently added within a moment of its scan, nothing touched.
 * Before, the app never asked, and a wall kept what it first loaded until its sort was changed and changed back.
 */
class AlbumsMark {
    /** The mark last seen; null until the server has answered one. */
    var last: String? = null
        private set

    /** [mark] seen: whether the albums moved since the last one (the first seen is where they stand, not a move). */
    fun seen(mark: String): Boolean {
        if (mark.isEmpty()) return false
        val moved = last != null && last != mark
        last = mark
        return moved
    }

    /** Forgotten (another server, or none): the next mark seen is where the albums stand. */
    fun forget() { last = null }

    companion object {
        /** How long a move is let gather before the screens read their albums again: a scan adds folder after folder. */
        const val GATHER_MS = 1_000L

        /** The mark in [j], /api/library/mark's answer; "" when it carries none. */
        fun of(j: JSONObject): String = j.optString("albums", "")

        /**
         * How long to wait before asking again, once an answer that [waited] (asked with the mark the app has) came in
         * [tookMs] and [moved] the albums or not: at once, unless a wait came back at once with nothing moved (a server
         * from before the wait, which answers straight away), then ten seconds, as the page asks.
         */
        fun pauseMs(waited: Boolean, moved: Boolean, tookMs: Long): Long = if (waited && !moved && tookMs < 2_000L) 10_000L else 0L
    }
}
