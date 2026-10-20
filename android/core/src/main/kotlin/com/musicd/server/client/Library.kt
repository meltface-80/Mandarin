package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The library as the server lists it, typed (stage N1 of
 * old/plan-android-native.md), for the native screens to come: the
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
    val hires: Boolean = false,
    /** A disc of a box set filed as albums of their own: which box, which disc. */
    val box: Box? = null,
    /** A streamed album's id on its service, and whether it is one of your favourites there (null: not signed in, or unknown). */
    val serviceId: String? = null,
    val serviceFavourite: Boolean? = null
) {
    /** The service's name as the page writes it ("Qobuz", "Tidal"); null for the library's own files. */
    val serviceName: String? get() = when (source) { "qobuz" -> "Qobuz"; "tidal" -> "Tidal"; else -> null }

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
            hires = j.optBoolean("hires", false),
            box = j.optJSONObject("box")?.let { Box(it.optString("name", ""), it.optInt("disc", 0), it.optInt("of", 0)) },
            serviceId = j.str("service_id"),
            serviceFavourite = if (j.opt("service_favourite") is Boolean) j.getBoolean("service_favourite") else null
        )
    }
}

/** The box set a disc is from: "From {name} · disc {disc} of {of}", as the page says it. */
data class Box(val name: String, val disc: Int, val of: Int) {
    val text: String get() = "From $name · disc $disc of $of"
}

/**
 * Why a streamed album is in the library, as its page says it under the
 * head (public/app/album-detail.js): a favourite or a purchase on the
 * service ([kept]: "purchase", or anything else a favourite) since [since]
 * (ms), held by a playlist or a favourite track ([held]), or only played;
 * and, for one not out yet, [releases], its day.
 */
data class ServiceWhy(val name: String, val kept: String?, val since: Long?, val held: Boolean, val releases: String?) {
    fun text(locale: java.util.Locale = java.util.Locale.getDefault()): String {
        val whenSince = since?.let { " since " + java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", locale)) }.orEmpty()
        var t = when {
            kept == "purchase" -> "In your library as a $name purchase$whenSince"
            kept != null -> "In your library as a $name favourite$whenSince"
            held -> "Here for a $name playlist or favourite track — not in your favourites"
            else -> "Played from $name — not in your favourites"
        }
        releases?.let { t += " · not out until " + ReleaseDate.format(it, locale).ifEmpty { it } }
        return t
    }

    companion object {
        fun parse(j: JSONObject): ServiceWhy {
            val k = j.opt("kept")
            return ServiceWhy(
                name = j.optString("name", ""),
                kept = when (k) { null, JSONObject.NULL, false -> null; true -> "favourite"; else -> k.toString().ifEmpty { null } },
                since = if (j.isNull("since")) null else j.optLong("since").takeIf { it > 0 },
                held = j.optBoolean("held", false),
                releases = j.str("releases")
            )
        }
    }
}

/** One of an album's booklets (/api/album/booklets): the PDF beside its tracks, its [pages] drawn by the server one at a time. */
data class Booklet(val id: String, val name: String, val pages: Int) {
    /** The row's words in the choice of several: "Booklet · 12 pages". */
    val text: String get() = "$name · $pages page" + (if (pages == 1) "" else "s")

    companion object {
        fun list(j: JSONObject): List<Booklet> = j.optJSONArray("booklets").items { Booklet(it.optString("id", ""), it.optString("name", ""), it.optInt("pages", 0)) }.filter { it.id.isNotEmpty() }

        /** The book button's label, as the page's: "Booklet", or "{n} booklets". */
        fun label(n: Int): String = if (n == 1) "Booklet" else "$n booklets"
    }
}

/** An album in the list its page was opened from (a row, a wall), for previous and next. */
data class NavItem(val offset: Long, val title: String)

/** The list the page hands the app as it opens an album ({items: [{offset, title}], index}): the items, and where this album is in them. */
data class NavList(val items: List<NavItem>, val index: Int) {
    companion object {
        fun parse(json: String?): NavList? {
            val j = runCatching { JSONObject(json ?: return null) }.getOrNull() ?: return null
            val items = j.optJSONArray("items").items { NavItem(it.optLong("offset", -1), it.optString("title", "")) }.filter { it.offset >= 0 }
            val at = j.optInt("index", -1)
            return if (items.size > 1 && at in items.indices) NavList(items, at) else null
        }
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

/** A movement of a work: the track's place in the album's list, and its name as a movement ("I. Largo sostenuto"). */
data class Movement(val track: Int, val title: String)

/**
 * A work of a classical album with its movements (/api/album `works`, bug list item 48), or a plain track
 * ([title] null, one movement with the track's own name), in the album's order.
 */
data class Work(val title: String?, val composer: String?, val conductor: String?, val performers: List<String>, val disc: Long?, val length: Double, val movements: List<Movement>) {
    companion object {
        fun parse(j: JSONObject) = Work(j.str("title"), j.str("composer"), j.str("conductor"), j.optJSONArray("performers").strings(),
            if (!j.has("disc") || j.isNull("disc")) null else j.optLong("disc"), j.optDouble("length", 0.0),
            j.optJSONArray("movements").items { Movement(it.optInt("track", 0), it.optString("title", "")) })
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
    val partial: Boolean,
    /** Named from its folders, its files carrying no tags. */
    val namesFromFolders: Boolean = false,
    /** A streamed album, signed in: why it is here. */
    val serviceWhy: ServiceWhy? = null,
    /** A classical album (item 48): its tracks as works, and the names for its head. */
    val works: List<Work> = emptyList(),
    val composers: List<String> = emptyList(),
    val conductor: String? = null,
    val performers: List<String> = emptyList()
) {
    /** Set out as works: at least one of them named (an album with none is the plain list). */
    val classical: Boolean get() = works.any { it.title != null }
    /** The box's discs in order, this one among them: the page's "Disc n · title" buttons (all but this one). */
    val boxDiscs: List<AlbumSummary> get() = if (album.box == null) emptyList() else (boxAlbums + album).sortedBy { it.box?.disc ?: 0 }
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
                partial = j.optBoolean("partial", false),
                namesFromFolders = j.optBoolean("names_from_folders", false),
                serviceWhy = a.optJSONObject("service_why")?.let(ServiceWhy::parse),
                works = j.optJSONArray("works").items(Work::parse),
                composers = a.optJSONArray("composers").strings(),
                conductor = a.str("conductor"),
                performers = a.optJSONArray("performers").strings()
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

/**
 * The library searched (/api/search): the albums found, best first, and the artists and labels whose names match; while
 * the index is first being built, [building] with how far ([progress], 0 to 1) and nothing found yet (item 61).
 */
data class SearchResults(val query: String, val albums: List<AlbumSummary>, val artists: List<String>, val labels: List<String>,
                         val building: Boolean = false, val progress: Double = 0.0) {
    /** Nothing found of any kind. */
    val empty: Boolean get() = albums.isEmpty() && artists.isEmpty() && labels.isEmpty()

    /** The count beside the field, as the page writes it: "3 artists, 1 label, 60+ albums" (the + where the 60 asked for came back). */
    fun status(): String {
        if (building) return "Building index… " + Math.round(progress * 100) + "%"
        val parts = ArrayList<String>()
        if (artists.isNotEmpty()) parts += "${artists.size} artist" + (if (artists.size == 1) "" else "s")
        if (labels.isNotEmpty()) parts += "${labels.size} label" + (if (labels.size == 1) "" else "s")
        if (albums.isNotEmpty()) parts += "${albums.size}" + (if (albums.size >= 60) "+" else "") + " album" + (if (albums.size == 1) "" else "s")
        return parts.joinToString(", ")
    }

    companion object {
        fun parse(j: JSONObject) = SearchResults(
            j.optString("query", ""), j.optJSONArray("results").items(AlbumSummary::parse),
            names(j.optJSONArray("artists")), names(j.optJSONArray("labels")),
            j.optBoolean("building", false), j.optDouble("progress", 0.0).let { if (it.isNaN()) 0.0 else it }
        )

        // A name, or an object with one (an artist's "name", a label's "display").
        private fun names(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { i ->
            a.optJSONObject(i)?.let { it.optString("name", it.optString("display", it.optString("title", ""))) } ?: a.optString(i)
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
