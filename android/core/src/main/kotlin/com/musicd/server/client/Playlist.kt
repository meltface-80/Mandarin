package com.musicd.server.client

import org.json.JSONObject

/*
 * Your own playlists, typed (the Playlists group of docs/specs/plan-android-native.md,
 * P1 and P2's page; bug list item 65): the list is Home's (PlaylistTile.mine);
 * one playlist (/api/user-playlist) with its tracks, each a track of an album of
 * the library's, as the page's playlists.js reads them.
 */

/** One track of a playlist: which album and which of its tracks, with the names it was added under and its album's cover. */
data class PlaylistTrack(val albumOffset: Long, val trackIndex: Int, val title: String, val subtitle: String, val albumTitle: String, val albumSubtitle: String, val imageKey: String?,
                         /** Its number on its album, where the server has it (a playlist shared names it; item 94). */
                         val trackNo: Int? = null) {
    /** The line under the title, as the page writes it: the artist, then the album ("Artist A · Album One"). */
    val line: String get() = listOf(subtitle, albumTitle).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** One of your playlists with its tracks. */
data class UserPlaylist(val id: String, val name: String, val tracks: List<PlaylistTrack>) {
    /** How many tracks, as the page words it under the name ("2 tracks"). */
    val count: String get() = "${tracks.size} track" + (if (tracks.size == 1) "" else "s")

    companion object {
        fun parse(j: JSONObject): UserPlaylist {
            val a = j.optJSONArray("tracks")
            val tracks = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
                PlaylistTrack(it.optLong("album_offset"), it.optInt("track_index"), it.optString("title"), it.optString("subtitle"), it.optString("album_title"),
                    it.optString("album_subtitle"), if (it.isNull("image_key")) null else it.optString("image_key").ifEmpty { null },
                    if (it.isNull("track_no")) null else it.optInt("track_no").takeIf { n -> n > 0 })
            }
            return UserPlaylist(j.optString("id"), j.optString("name").ifEmpty { "Playlist" }, tracks)
        }

        /**
         * What a playlist played or queued says afterwards, as the page's playUserPlaylist does: "Playing 2 tracks", "Queued
         * 3 tracks", with those that couldn't be found counted; all of them refused, the first refusal.
         */
        fun report(kind: String, queued: Int, failed: Int, firstError: String): String {
            if (queued == 0) return firstError.ifEmpty { "Sonos refused those tracks" }
            val verb = when (kind) { "queue" -> "Queued"; "play_next" -> "Playing next:"; else -> "Playing" }
            return "$verb $queued track" + (if (queued == 1) "" else "s") + (if (failed > 0) " ($failed couldn't be found: $firstError)" else "")
        }
    }
}
