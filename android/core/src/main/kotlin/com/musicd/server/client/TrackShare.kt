package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * A playlist shared as a file of what it holds (bug list item 95), as the page's playlist-share.js (shareTracks,
 * openShareSheet) and native-handoff.js (shareSmartTracks) have it: a Dynamic Playlist's tracks read album by album, the
 * server asked to turn them into the file's text (POST /api/share/encode), and the sheet's honest account of what went in.
 */

/** A Dynamic Playlist's tracks as read for sharing: each as the file names it, and why the file might hold less than all of it. */
data class SharedTracks(val entries: List<JSONObject>, val incomplete: Boolean, val albumsCapped: Boolean)

/** The share sheet's account: how many tracks went in ([sum]) and each reason the file is less than the whole playlist. */
data class ShareAccount(val sum: String, val warnings: List<String>)

object TrackShare {
    /** The most albums one go reads (the page's SHARE_ALBUM_MAX). */
    const val ALBUM_MAX = 100
    const val NOTE = "This describes the music, not the music itself. Whoever imports it gets whatever their own library or streaming service can match."
    const val COPIED = "Copied — paste it to whoever you're sharing with"
    const val NOTHING = "Nothing in this playlist to share"

    /**
     * A Dynamic Playlist's tracks read a page at a time ([page]: its answer at an album offset, null when it failed), as
     * shareSmartTracks reads them: until the server says it is done, a page expands no album, or [ALBUM_MAX] albums are in.
     */
    fun gather(page: (Int) -> JSONObject?): SharedTracks {
        val out = ArrayList<JSONObject>()
        var offset = 0; var done = false; var failed = false
        while (!done && offset < ALBUM_MAX) {
            val j = page(offset)
            if (j == null) { failed = true; break }
            val tracks = j.optJSONArray("tracks")
            if (tracks != null) for (i in 0 until tracks.length()) tracks.optJSONObject(i)?.let { out += entry(it) }
            val expanded = j.optInt("albums_expanded")
            if (expanded <= 0) break
            offset += expanded
            done = j.optBoolean("done")
        }
        return SharedTracks(out, failed, !done && offset >= ALBUM_MAX)
    }

    /** A track as the file names it: its title, artist, album and number, and nothing else. */
    fun entry(t: JSONObject): JSONObject = JSONObject().put("title", t.opt("title") ?: JSONObject.NULL).put("artist", t.opt("subtitle") ?: JSONObject.NULL)
        .put("album", t.opt("album_title") ?: JSONObject.NULL).put("track_no", t.opt("track_no") ?: JSONObject.NULL)

    /** What the server is asked to encode. */
    fun body(name: String, entries: List<JSONObject>): JSONObject = JSONObject().put("name", name).put("tracks", JSONArray(entries))

    /** The sheet's account of the file the server made ([j]), with what reading it found ([incomplete], [albumsCapped], [sourceTruncated]). */
    fun account(j: JSONObject, incomplete: Boolean = false, albumsCapped: Boolean = false, sourceTruncated: Boolean = false): ShareAccount {
        val n = j.optInt("track_count")
        val w = ArrayList<String>()
        if (incomplete) w += "Reading stopped early because the server returned an error — this file is INCOMPLETE. Try again before sharing it."
        if (albumsCapped) w += "Only the first $ALBUM_MAX albums were read — that's the limit for one go."
        if (sourceTruncated) w += "The playlist is longer than this app can read in one go, so the end of it isn't here."
        if (j.optBoolean("truncated")) w += "Stopped at the sharing limit of tracks."
        val skipped = j.optInt("skipped")
        if (skipped > 0) w += "$skipped entr" + (if (skipped == 1) "y" else "ies") + " had no title and " + (if (skipped == 1) "was" else "were") + " left out."
        val bytes = j.optLong("bytes")
        if (bytes > 40000) w += "This is ${Math.round(bytes / 1024.0)} KB — too big to paste reliably. Use Download and send the file."
        return ShareAccount("$n track" + if (n == 1) "" else "s", w)
    }

    /** The file's name for Download: the playlist's name, each run of anything but letters and digits one "_", 60 at most. */
    fun fileName(name: String): String = name.ifEmpty { "playlist" }.replace(Regex("[^a-z0-9]+", RegexOption.IGNORE_CASE), "_").take(60) + ".musicd"
}
