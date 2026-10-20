package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/**
 * What Add to playlist adds (the page's openAddToPlaylistSheet and addToUserPlaylist, playlists.js and playlist-import.js;
 * bug list item 93): the tracks picked on an album's page, each as itself, or whole albums, whose tracklists only the
 * server reads ([albums] set; a route of its own). Exactly one of the two.
 */
class PlaylistAdd private constructor(private val tracks: List<JSONObject>?, val albums: List<AlbumSummary>?) {
    /** How many tracks or albums. */
    val count: Int get() = tracks?.size ?: albums?.size ?: 0

    /** The sheet's title: "Add 3 tracks to…", "Add 1 album to…". */
    val title: String get() = "Add $count " + (if (tracks != null) "track" else "album") + (if (count == 1) "" else "s") + " to…"

    /** Where it is posted. */
    val path: String get() = if (albums != null) "/api/user-playlists/add-albums" else "/api/user-playlists/add"

    /** What is said while the server reads the albums' tracklists; none for tracks. */
    val reading: String? get() = albums?.let { "Reading ${it.size} album" + (if (it.size == 1) "" else "s") + "…" }

    /** The body for the playlist [id], or a new one called [name]. */
    fun body(id: String?, name: String?): JSONObject {
        val j = JSONObject()
        if (id != null) j.put("id", id)
        if (name != null) j.put("name", name)
        if (albums != null) j.put("albums", JSONArray().apply {
            for (a in albums) put(JSONObject().put("offset", a.offset).put("title", a.title).put("subtitle", a.subtitle).put("image_key", a.imageKey ?: JSONObject.NULL))
        })
        else j.put("tracks", JSONArray().apply { tracks?.forEach { put(it) } })
        return j
    }

    companion object {
        /** The tracks at [picks] of album [a], in the album's order, as the page's own selection makes them. */
        fun tracks(a: Album, picks: List<Int>): PlaylistAdd = PlaylistAdd(picks.sorted().filter { it in a.tracks.indices }.map { i ->
            JSONObject().put("album_offset", a.album.offset).put("album_title", a.album.title).put("album_subtitle", a.album.subtitle)
                .put("track_index", i).put("title", a.tracks[i].title).put("subtitle", a.album.subtitle).put("image_key", a.album.imageKey ?: JSONObject.NULL)
        }, null)

        /** Whole [albums], every track of each. */
        fun albums(albums: List<AlbumSummary>): PlaylistAdd = PlaylistAdd(null, albums)
    }
}

/** One of your playlists as the sheet lists it: its name and how many tracks it holds. */
data class PlaylistChoice(val id: String, val name: String, val tracks: Int) {
    /** Its row: "Road trip · 1 track". */
    val label: String get() = "$name · $tracks track" + (if (tracks == 1) "" else "s")
}

object AddToPlaylist {
    const val NEW = "＋ New playlist…"
    const val ASK = "Name this playlist"
    const val SUGGESTED = "My playlist"
    const val NO_NAME = "Give it a name"

    /** Your playlists (GET /api/user-playlists), in the server's order, as the sheet lists them. */
    fun choices(j: JSONObject): List<PlaylistChoice> {
        val a = j.optJSONArray("playlists") ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { PlaylistChoice(it.optString("id"), it.optString("name"), it.optInt("track_total")) }
    }

    /**
     * What is said once added ([j]: the server's answer), and whether it is said as an error (an album the server couldn't
     * read, named, since knowing which is the only way to do anything about it).
     */
    fun said(j: JSONObject): Pair<String, Boolean> {
        val added = j.optInt("added")
        var msg = "Added $added track" + (if (added == 1) "" else "s")
        if (j.has("albums_read") && !j.isNull("albums_read")) j.optInt("albums_read").let { n -> msg += " from $n album" + (if (n == 1) "" else "s") }
        msg += " to \"" + j.optString("name") + "\""
        if (j.optBoolean("full")) msg += " — the playlist is now full"
        val skipped = j.optInt("skipped")
        if (skipped > 0) msg += "; $skipped couldn't be stored" + j.optString("reason").let { if (it.isNotEmpty()) " ($it)" else "" }
        val failed = j.optJSONArray("albums_failed")?.let { f -> (0 until f.length()).map { f.optString(it) } }.orEmpty()
        if (failed.isNotEmpty()) msg += "; couldn't read " + failed.joinToString(", ")
        return msg to failed.isNotEmpty()
    }
}
