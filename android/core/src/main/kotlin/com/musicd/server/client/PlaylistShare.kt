package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * A playlist shared as text and one imported from it (bug list item 94), as the page's playlist-share.js and
 * playlist-import.js say them: what the server made of a playlist to share (POST /api/share/encode), and what it found of
 * a shared one in this library (POST /api/share/import). The music is never in it, only what names it.
 */

/** Why a file to share may be less than the whole playlist, as only the one asking knows (the page's caveats). */
data class ShareCaveats(
    /** Reading stopped early on an error. */
    val incomplete: Boolean = false,
    /** Only the first [PlaylistShare.ALBUM_MAX] albums were read. */
    val albumsCapped: Boolean = false,
    /** The playlist was longer than could be read in one go. */
    val sourceTruncated: Boolean = false,
)

/** A playlist made into text to share ([blob]), with how many tracks went in and what was left out. */
data class ShareFile(val blob: String, val bytes: Int, val trackCount: Int, val skipped: Int, val truncated: Boolean) {
    /** The line over it: how many tracks. */
    val sum: String get() = "$trackCount track" + (if (trackCount == 1) "" else "s")

    /** Each reason the file is less than the whole playlist, or too big to paste, a line each. */
    fun warnings(c: ShareCaveats = ShareCaveats()): List<String> {
        val out = mutableListOf<String>()
        if (c.incomplete) out += "Reading stopped early because the server returned an error — this file is INCOMPLETE. Try again before sharing it."
        if (c.albumsCapped) out += "Only the first ${PlaylistShare.ALBUM_MAX} albums were read — that's the limit for one go."
        if (c.sourceTruncated) out += "The playlist is longer than this app can read in one go, so the end of it isn't here."
        if (truncated) out += "Stopped at the sharing limit of tracks."
        if (skipped > 0) out += "$skipped entr" + (if (skipped == 1) "y" else "ies") + " had no title and " + (if (skipped == 1) "was" else "were") + " left out."
        if (bytes > 40000) out += "This is ${Math.round(bytes / 1024.0)} KB — too big to paste reliably. Use Download and send the file."
        return out
    }

    companion object {
        fun parse(j: JSONObject) = ShareFile(j.optString("blob"), j.optInt("bytes"), j.optInt("track_count"), j.optInt("skipped"), j.optBoolean("truncated"))
    }
}

/** What the library made of a shared playlist: the tracks it has ([resolved], as the server gave them, to save), and those it hasn't. */
data class ImportReport(
    val name: String,
    val total: Int,
    val resolved: JSONArray,
    /** Each track it couldn't match, as the page lists it: its title, artist and album. */
    val missing: List<String>,
    /** Each track found on another album than the playlist named: its title and artist, then the album it was found on. */
    val substituted: List<String>,
    val truncated: Boolean,
    /** Whether a second, slower search of the library's albums can find more. */
    val deepAvailable: Boolean,
) {
    val found: Int get() = resolved.length()
    val sum: String get() = "$found of $total track" + (if (total == 1) "" else "s") + " found in your library"
    val missingWarn: String? get() = if (missing.isEmpty()) null else "${missing.size} couldn't be matched:"
    val subNote: String? get() = if (substituted.isEmpty()) null else "${substituted.size} found on a different album than the playlist named:"
    /** The lists as shown: 25 at most, then how many more. */
    val missingShown: List<String> get() = capped(missing)
    val substitutedShown: List<String> get() = capped(substituted)
    val saveLabel: String get() = "Save $found track" + (if (found == 1) "" else "s") + " as a playlist"
    val searching: String get() = "Looking inside your albums for the other ${missing.size}…"

    companion object {
        const val TRUNCATED = "That playlist is longer than one import can take — the end of it was left out."
        const val NOTHING = "Nothing here matched, so there's nothing to save."

        fun parse(j: JSONObject): ImportReport {
            fun list(key: String, line: (JSONObject) -> String): List<String> {
                val a = j.optJSONArray(key) ?: return emptyList()
                return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map(line)
            }
            fun join(vararg parts: String) = parts.filter { it.isNotEmpty() }.joinToString(" · ")
            return ImportReport(j.optString("name").ifEmpty { "Shared playlist" }, j.optInt("total"), j.optJSONArray("resolved") ?: JSONArray(),
                list("missing") { join(it.optString("title"), it.optString("artist"), it.optString("album")) },
                list("substituted") { join(it.optString("title"), it.optString("artist")) + " — " + it.optString("found_album").ifEmpty { "your library" } },
                j.optBoolean("truncated"), j.optBoolean("deep_available"))
        }

        private fun capped(all: List<String>) = if (all.size <= 25) all else all.take(25) + "…and ${all.size - 25} more"
    }
}

object PlaylistShare {
    /** The most albums one share reads (the page's SHARE_ALBUM_MAX). */
    const val ALBUM_MAX = 100
    const val SHARE_NOTE = "This describes the music, not the music itself. Whoever imports it gets whatever their own library or streaming service can match."
    const val IMPORT_NOTE = "Paste a playlist someone shared with you. It describes the music, so you'll get the tracks your own library can match — the rest are listed so you know what's missing."
    const val COPIED = "Copied — paste it to whoever you're sharing with"

    /** What is shared of each track, built field by field from the playlist's own: its title, artist, album and number. */
    fun body(name: String, tracks: List<PlaylistTrack>): JSONObject = JSONObject().put("name", name).put("tracks", JSONArray().apply {
        for (t in tracks) put(JSONObject().put("title", t.title).put("artist", t.subtitle).put("album", t.albumTitle).put("track_no", t.trackNo ?: JSONObject.NULL))
    })

    /** The file Download writes: the playlist's name made safe, as the page's. */
    fun fileName(name: String): String = name.ifEmpty { "playlist" }.replace(Regex("[^a-zA-Z0-9]+"), "_").take(60) + ".musicd"

    /** What is said once tracks are added to a playlist (POST /api/user-playlists/add's answer), as the page's addToUserPlaylist says it. */
    fun added(j: JSONObject): String {
        val n = j.optInt("added")
        var msg = "Added $n track" + (if (n == 1) "" else "s")
        if (j.has("albums_read")) j.optInt("albums_read").let { a -> msg += " from $a album" + (if (a == 1) "" else "s") }
        msg += " to \"${j.optString("name")}\""
        if (j.optBoolean("full")) msg += " — the playlist is now full"
        val skipped = j.optInt("skipped")
        if (skipped > 0) msg += "; $skipped couldn't be stored" + j.optString("reason").let { r -> if (r.isNotEmpty()) " ($r)" else "" }
        val failed = j.optJSONArray("albums_failed")
        if (failed != null && failed.length() > 0) msg += "; couldn't read " + (0 until failed.length()).joinToString(", ") { failed.optString(it) }
        return msg
    }
}
