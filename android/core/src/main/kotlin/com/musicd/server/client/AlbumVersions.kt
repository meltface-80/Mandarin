package com.musicd.server.client

import org.json.JSONObject

/**
 * One version of an album as its page lists them (item 345, /api/album "versions"): the album, what tells it apart
 * ([label]: "2015 Remaster · 24/96", "Original · 16/44.1"), whether it is the main one (the one the lists show) and
 * whether it is the one open ([current]). Since item 349 a row of its own on the album's Versions tab: its edition alone
 * ([edition]: "2015 Remaster", "Original", "12 tracks"), its tracks, length and year.
 */
data class AlbumVersion(val album: AlbumSummary, val label: String, val main: Boolean, val current: Boolean,
                        val edition: String? = null, val tracks: Int? = null, val seconds: Int? = null, val releaseYear: Int? = null) {
    /** Its words, as the page writes them: the label, " · Main" after the main one's. */
    val words: String get() = label.ifEmpty { album.title } + if (main) " · Main" else ""

    /** Its row's name: its edition, else the album's title. */
    val name: String get() = edition?.takeIf { it.isNotEmpty() } ?: album.title

    /** Its row's format: "24-bit / 96 kHz" from "24/96"; the quality as it is where it isn't bits over a rate. */
    val format: String get() {
        val q = album.quality ?: return ""
        val m = Regex("""^(\d+)/([\d.]+)$""").find(q) ?: return q
        return "${m.groupValues[1]}-bit / ${m.groupValues[2]} kHz"
    }

    /** Its row's facts: "12 tracks · 43:45 · 2015", each where known. */
    val facts: String get() = listOfNotNull(
        tracks?.let { if (it == 1) "1 track" else "$it tracks" },
        seconds?.takeIf { it > 0 }?.let { s -> if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60) },
        (releaseYear ?: album.year)?.toString(),
    ).joinToString(" · ")

    companion object {
        fun parse(j: JSONObject) = AlbumVersion(AlbumSummary.parse(j), j.optString("label", "").takeIf { !j.isNull("label") }.orEmpty(),
            j.optBoolean("main", false), j.optBoolean("current", false),
            edition = j.optString("edition", "").takeIf { !j.isNull("edition") && it.isNotEmpty() },
            tracks = j.optInt("tracks", 0).takeIf { j.has("tracks") && !j.isNull("tracks") && it > 0 },
            seconds = j.optInt("seconds", 0).takeIf { j.has("seconds") && !j.isNull("seconds") && it > 0 },
            releaseYear = j.optInt("release_year", 0).takeIf { j.has("release_year") && !j.isNull("release_year") && it > 0 })

        /** The tile's line under the artist ("2 versions"); null for an album of one. */
        fun mark(a: AlbumSummary): String? = a.versions?.takeIf { it > 1 }?.let { "$it versions" }

        /** The head over an album page's versions ("2 versions"). */
        fun head(n: Int): String = "$n versions"

        /** Under it: what the list is for. */
        const val HEAD_NOTE = "The library shows the main one"

        /** The Credits tab where none are known (item 349). */
        const val NO_CREDITS = "No credits known for this album yet"

        /** A version's own tags: the main one, the one open. */
        const val MAIN_TAG = "Main"
        const val VIEWING_TAG = "Viewing"

        /** Make main's words, as the page says them: to do, under way, done, and when it couldn't be saved. */
        const val MAKE_MAIN = "Make this the main version"
        const val SAVING = "Saving…"
        const val IS_MAIN = "The main version"
        const val FAILED = "Couldn't save that — try again"
    }
}
