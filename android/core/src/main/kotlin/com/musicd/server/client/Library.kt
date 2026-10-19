package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The library as the server lists it, typed (stage N1 of
 * docs/specs/plan-android-native.md), for the native screens to come: the
 * albums, an album's page, the artists, the search, and Home's rows. Each as
 * the C# server answers it: test/golden/android-api.json holds its answers on
 * the suite's own library, AndroidApiTests keeps that file the server's, and
 * LibraryTest reads it here. What a screen can't do without (an album's
 * offset and title, a track's id) must be there; the rest may be missing.
 */

private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k)
private fun JSONObject.int(k: String): Int? = if (!has(k) || isNull(k)) null else optInt(k)
private fun <T> JSONArray?.items(parse: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }.map(parse)
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }

/** An album as every list shows it: its offset (the id it is asked for by), title, artist line and cover. */
data class AlbumSummary(
    val offset: Long,
    val title: String,
    val subtitle: String,
    val imageKey: String?,
    val quality: String?,
    val year: Int?,
    val discs: Int?,
    /** "qobuz" or "tidal" for a service's album, null for the library's own. */
    val source: String?,
    /** The heart: one of your favourites. */
    val favourite: Boolean = false,
    /** On your Listen later list. */
    val later: Boolean = false,
    /** Better than CD: its rate in brass. */
    val hires: Boolean = false
) {
    companion object {
        fun parse(j: JSONObject) = AlbumSummary(
            offset = j.getLong("offset"),
            title = j.getString("title"),
            subtitle = j.optString("subtitle", ""),
            imageKey = j.str("image_key"),
            quality = j.str("quality"),
            year = j.int("year"),
            discs = j.int("discs"),
            source = j.str("source"),
            favourite = j.optBoolean("favourite", false),
            later = j.optBoolean("later", false),
            hires = j.optBoolean("hires", false)
        )
    }
}

/** A page of the library's albums (/api/library/albums): these, from [offset], of [total]. */
data class AlbumPage(val albums: List<AlbumSummary>, val offset: Int, val total: Int) {
    companion object {
        fun parse(j: JSONObject) = AlbumPage(j.optJSONArray("albums").items(AlbumSummary::parse), j.optInt("offset", 0), j.optInt("total", 0))
    }
}

/** One of an album's tracks: [length] in seconds, [subtitle] as the page shows it ("0:03"). */
data class Track(val id: Long, val title: String, val subtitle: String, val length: Double, val quality: String?) {
    /** Its subtitle as the page splits it: who else is on it ("Artist B · 4:05" → "Artist B"), and its length ("4:05"). */
    val sub: String get() = split().first
    val lengthText: String get() = split().second

    private fun split(): Pair<String, String> {
        val parts = subtitle.split(" · ")
        return if (Regex("^\\d+:\\d{2}(:\\d{2})?$").matches(parts.last())) parts.dropLast(1).joinToString(" · ") to parts.last() else subtitle to ""
    }

    companion object {
        fun parse(j: JSONObject) = Track(j.getLong("track_id"), j.getString("title"), j.optString("subtitle", ""), j.optDouble("length", 0.0), j.str("quality"))
    }
}

/** What can be done with an album ("play_now", "queue", …), each with its own words. */
data class AlbumAction(val kind: String, val title: String)

/** An album's page (/api/album): the album, its genres, tracks and artists, and what can be done with it. */
data class Album(
    val album: AlbumSummary,
    val genres: List<String>,
    val tracks: List<Track>,
    val actions: List<AlbumAction>,
    val artists: List<String>,
    /** The albums of the box set it is part of, if any. */
    val boxAlbums: List<AlbumSummary>,
    /** Some tracks missing: fewer here than the tags say. */
    val partial: Boolean
) {
    companion object {
        fun parse(j: JSONObject): Album {
            val a = j.getJSONObject("album")
            return Album(
                album = AlbumSummary.parse(a),
                genres = a.optJSONArray("genres").strings(),
                tracks = j.optJSONArray("tracks").items(Track::parse),
                actions = j.optJSONArray("actions").items { AlbumAction(it.getString("kind"), it.optString("title", "")) },
                artists = j.optJSONArray("artists").strings(),
                boxAlbums = j.optJSONArray("box_albums").items(AlbumSummary::parse),
                partial = j.optBoolean("partial", false)
            )
        }
    }
}

/** An artist as the Artists list shows them (/api/artists). */
data class Artist(val name: String, val albumCount: Int, val imageKey: String?)

data class ArtistPage(val artists: List<Artist>, val offset: Int, val total: Int) {
    companion object {
        fun parse(j: JSONObject) = ArtistPage(
            j.optJSONArray("artists").items { Artist(it.getString("name"), it.optInt("albumCount", 0), it.str("image_key")) },
            j.optInt("offset", 0), j.optInt("total", 0)
        )
    }
}

/** An artist's albums (/api/artist-albums): their own, and those they are on. */
data class ArtistAlbums(val artist: String, val primary: List<AlbumSummary>, val featured: List<AlbumSummary>) {
    companion object {
        fun parse(j: JSONObject) = ArtistAlbums(j.optString("artist", ""), j.optJSONArray("primary").items(AlbumSummary::parse), j.optJSONArray("featured").items(AlbumSummary::parse))
    }
}

/** The library searched (/api/search): the albums found, best first, and the artists and labels whose names match. */
data class SearchResults(val query: String, val albums: List<AlbumSummary>, val artists: List<String>, val labels: List<String>) {
    companion object {
        fun parse(j: JSONObject) = SearchResults(
            j.optString("query", ""), j.optJSONArray("results").items(AlbumSummary::parse),
            names(j.optJSONArray("artists")), names(j.optJSONArray("labels"))
        )

        // A name, or an object with one.
        private fun names(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { i ->
            a.optJSONObject(i)?.let { it.optString("name", it.optString("title", "")) } ?: a.optString(i)
        }
    }
}

/** One of Home's rows, in the owner's order: [on] when shown, [unavailable] why it can't be (a setting off). */
data class HomeRow(val id: String, val on: Boolean, val unavailable: String?)

object HomeRows {
    fun parse(j: JSONObject): List<HomeRow> = j.optJSONArray("rows").items { HomeRow(it.getString("id"), it.optBoolean("on", true), it.str("unavailable")) }
}

/** A Home row of albums (Recently played, Not played): the albums, latest first. */
data class AlbumRow(val albums: List<AlbumSummary>) {
    companion object {
        fun parse(j: JSONObject) = AlbumRow(j.optJSONArray("albums").items(AlbumSummary::parse))
    }
}

/** Today's album (/api/home/album-of-the-day): none once it has been played today. */
data class AlbumOfTheDay(val album: AlbumSummary?, val played: Boolean, val day: String) {
    companion object {
        fun parse(j: JSONObject) = AlbumOfTheDay(j.optJSONObject("album")?.let(AlbumSummary::parse), j.optBoolean("played", false), j.optString("day", ""))
    }
}
