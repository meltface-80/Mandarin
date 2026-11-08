package com.musicd.server.client

import org.json.JSONObject

/**
 * One version of an album as its page lists them (item 345, /api/album "versions"): the album, what tells it apart
 * ([label]: "2015 Remaster · 24/96", "Original · 16/44.1"), whether it is the main one (the one the lists show) and
 * whether it is the one open ([current]).
 */
data class AlbumVersion(val album: AlbumSummary, val label: String, val main: Boolean, val current: Boolean) {
    /** Its pill's words, as the page writes them: the label, " · Main" after the main one's. */
    val words: String get() = label.ifEmpty { album.title } + if (main) " · Main" else ""

    companion object {
        fun parse(j: JSONObject) = AlbumVersion(AlbumSummary.parse(j), j.optString("label", "").takeIf { !j.isNull("label") }.orEmpty(),
            j.optBoolean("main", false), j.optBoolean("current", false))

        /** The tile's line under the artist ("2 versions"); null for an album of one. */
        fun mark(a: AlbumSummary): String? = a.versions?.takeIf { it > 1 }?.let { "$it versions" }

        /** The head over an album page's versions ("2 versions"). */
        fun head(n: Int): String = "$n versions"

        /** Make main's words, as the page says them: to do, under way, done, and when it couldn't be saved. */
        const val MAKE_MAIN = "Make this the main version"
        const val SAVING = "Saving…"
        const val IS_MAIN = "The main version"
        const val FAILED = "Couldn't save that — try again"
    }
}
