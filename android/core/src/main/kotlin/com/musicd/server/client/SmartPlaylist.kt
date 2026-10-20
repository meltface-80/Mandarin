package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * Dynamic Playlists, typed (the Playlists group of old/plan-android-native.md,
 * P3; bug list item 66): each a saved view of the library (its sort and focus),
 * made of albums or of their tracks, in album order or random, read afresh each
 * time it is opened; as the page's smart-playlists.js and smart-playlist.js read them.
 */

/**
 * A Dynamic Playlist as the list has it: what it is made of ([mode]), its [order], its saved [view], the first covers it
 * resolves to, and how many albums it plays at most ([limit], which its Edit keeps; item 95).
 */
data class SmartPlaylist(val id: String, val name: String, val view: JSONObject, val mode: String, val order: String, val artKeys: List<String>, val limit: Int = 100) {
    /** Tracks rather than whole albums. */
    val tracks: Boolean get() = mode == "tracks"

    /** The line under its name on its page: what it is made of, its order, then its view ("Albums · album order · Rock"). */
    val detail: String get() = listOf(if (tracks) "Tracks" else "Albums", if (order == "random") "random" else "album order", describe(view)).filter { it.isNotEmpty() }.joinToString(" · ")

    companion object {
        fun list(j: JSONObject): List<SmartPlaylist> = objs(j.optJSONArray("playlists")).map {
            SmartPlaylist(it.optString("id"), it.optString("name").ifEmpty { "Dynamic Playlist" }, it.optJSONObject("view") ?: JSONObject(),
                it.optString("mode").ifEmpty { "albums" }, it.optString("order").ifEmpty { "album" }, strings(it.optJSONArray("art_keys")).filter { k -> k.isNotEmpty() },
                it.optInt("limit").takeIf { n -> n > 0 } ?: 100)
        }

        /**
         * A saved view in a line, as the page's describeLibView: the sort with its arrow, each focus's values (an excluded
         * one "not …", a decade "1990s"), then what it asks of plays ("never played", "not in 6 months").
         */
        fun describe(v: JSONObject): String {
            val bits = ArrayList<String>()
            LibraryView.SORTS.firstOrNull { it.id == v.optString("sort") }?.let { bits += it.label + (if (v.optString("dir") == "desc") " ↓" else " ↑") }
            for (id in LibraryView.FACET_IDS) {
                val sel = values(v.opt(id))
                if (sel.isEmpty()) continue
                bits += sel.joinToString(", ") { x -> (if (x.startsWith("!")) "not " else "") + x.removePrefix("!") + (if (id == "decade") "s" else "") }
            }
            val played = v.optString("played")
            if (played.isNotEmpty() && played != "any") bits += LibraryView.PLAYED.firstOrNull { it.id == played }?.label?.lowercase() ?: "not played in $played months"
            return bits.joinToString(" · ")
        }

        private fun values(o: Any?): List<String> = when (o) {
            null, JSONObject.NULL -> emptyList()
            is JSONArray -> (0 until o.length()).map { num(o.get(it)) }
            else -> listOf(num(o))
        }
        // A decade the server keeps as a number reads as the page writes it (1990, not 1990.0).
        private fun num(o: Any): String = if (o is Double && o == Math.floor(o)) o.toLong().toString() else o.toString()
        internal fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.optString(it, "") }

        /**
         * What playing or queuing its albums says (the page's multiOutcome): "Playing 12 albums", "Queued 100 of 240
         * albums — that's the limit per go", with those the room refused.
         */
        fun outcome(verb: String, queued: Int, failed: Int, asked: Int, matched: Int?): String {
            val capped = matched != null && asked < matched
            var msg = "$verb $queued" + (if (capped) " of $matched" else "") + " album" + (if ((if (capped) matched!! else queued) == 1) "" else "s")
            if (failed > 0) msg += " (Sonos refused $failed)"
            if (capped) msg += " — that's the limit per go"
            return msg
        }
    }
}

/** A page of a tracks playlist's tracks (/api/smart-playlist): read a few albums at a time, [done] once the last is in. */
data class SmartTracks(val tracks: List<PlaylistTrack>, val albumsExpanded: Int, val albumTotal: Int, val done: Boolean) {
    companion object {
        fun parse(j: JSONObject) = SmartTracks(SmartPlaylist.objs(j.optJSONArray("tracks")).map {
            PlaylistTrack(it.optLong("album_offset"), it.optInt("track_index"), it.optString("title"), it.optString("subtitle"), it.optString("album_title"),
                it.optString("album_artist"), if (it.isNull("image_key")) null else it.optString("image_key").ifEmpty { null })
        }, j.optInt("albums_expanded"), j.optInt("album_total"), j.optBoolean("done", true))

        /** The line under the tracks, as the page writes it while they come and once they're all in. */
        fun status(shown: Int, albumsRead: Int, albumTotal: Int, done: Boolean): String = when {
            !done -> "$shown tracks so far — ${albumTotal - albumsRead} album(s) left"
            shown == 0 -> NOTHING
            else -> "$shown track" + (if (shown == 1) "" else "s") + " from $albumTotal album" + (if (albumTotal == 1) "" else "s")
        }
        const val NOTHING = "Nothing in your library matches this Dynamic Playlist right now."
    }
}

/** An albums playlist's albums (/api/smart-playlist/albums): those it plays, and how many matched (more, where its size caps it). */
data class SmartAlbums(val albums: List<AlbumSummary>, val matched: Int?) {
    /** The line under the albums: "12 albums", "100 of 240 albums that match". */
    val status: String get() = when {
        albums.isEmpty() -> SmartTracks.NOTHING
        matched != null && matched > albums.size -> "${albums.size} of $matched albums that match"
        else -> "${albums.size} album" + (if (albums.size == 1) "" else "s")
    }

    companion object {
        fun parse(j: JSONObject) = SmartAlbums(SmartPlaylist.objs(j.optJSONArray("albums")).map(AlbumSummary::parse),
            if (j.has("matched") && !j.isNull("matched")) j.optInt("matched") else if (j.has("total")) j.optInt("total") else null)
    }
}
