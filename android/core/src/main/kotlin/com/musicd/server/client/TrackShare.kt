package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * A playlist shared as a file of what it holds (bug list item 95), as the page's playlist-share.js (shareTracks,
 * openShareSheet) and native-handoff.js (shareSmartTracks) have it: a Dynamic Playlist's tracks read album by album, the
 * server asked to turn them into the file's text (POST /api/share/encode). The file and its sheet are a playlist's own
 * (PlaylistShare.kt's ShareFile, read with what reading found as its ShareCaveats).
 */

/** A Dynamic Playlist's tracks as read for sharing: each as the file names it, and why the file might hold less than all of it. */
data class SharedTracks(val entries: List<JSONObject>, val incomplete: Boolean, val albumsCapped: Boolean)

object TrackShare {
    /** The most albums one go reads (the page's SHARE_ALBUM_MAX). */
    const val ALBUM_MAX = 100
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
}
