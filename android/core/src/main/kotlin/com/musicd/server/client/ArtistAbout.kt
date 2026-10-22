package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k, "").ifEmpty { null }
private fun <T> JSONArray?.items(parse: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(parse) }
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, "").ifEmpty { null } }

/**
 * Who an act is (/api/artist, bug list items 129 and 131): their picture, what they are, where from and when, their
 * links, a band's members or a person's bands, and the library's albums they are credited on. [known] false: the
 * server hasn't found them (yet); the page then shows their albums and biography alone.
 */
data class ArtistAbout(
    val name: String, val known: Boolean, val mbid: String?, val type: String?, val photoKey: String?,
    val disambiguation: String?, val begin: String?, val end: String?, val ended: Boolean, val area: String?,
    val links: Map<String, String>, val members: List<Stint>, val memberOf: List<Stint>, val creditedOn: List<Credited>,
    val bandAlbums: List<BandAlbums> = emptyList(),
    /** Their genres, as their own albums are tagged, the most used first (item 139). */
    val genres: List<String> = emptyList()
) {
    /** One of a person's bands and its albums in the library from their years in it (item 133). */
    data class BandAlbums(val band: String, val albums: List<AlbumSummary>)

    /** One of a band's members, or one of a person's bands: their years in it and what they played. */
    data class Stint(val name: String, val begin: String?, val end: String?, val ended: Boolean, val roles: List<String>, val photoKey: String?, val inLibrary: Boolean) {
        /** Under the name: what they played and when ("guitar, vocals · 1982–1987"). */
        val line: String? get() = listOfNotNull(roles.joinToString(", ").ifEmpty { null }, years(begin, end, ended, null)).joinToString(" · ").ifEmpty { null }
    }

    /** An album of the library's they are credited on, and as what. */
    data class Credited(val album: AlbumSummary, val roles: List<String>)

    /** The line under the name: what they are, where from, their years ("Band · Manchester · 1982–1987"; "Liverpool · 1940–1980"). */
    val facts: String? get() {
        val kind = when (type) { "Group" -> "Band"; "Orchestra" -> "Orchestra"; "Choir" -> "Choir"; else -> null }
        return listOfNotNull(kind, area, years(begin, end, ended, type)).joinToString(" · ").ifEmpty { null }
    }

    /** Their links in the order the page shows them, each with its name (no MusicBrainz of its own: the owner's call, item 133). */
    val linkList: List<Pair<String, String>> get() = LINKS.mapNotNull { (kind, label) -> links[kind]?.let { label to it } }

    /** The albums credited on that aren't already among their own or those they appear on ([shown], by album offset). */
    fun creditedBeyond(shown: Set<Long>): List<Credited> = creditedOn.filter { it.album.offset !in shown }

    companion object {
        /** The kinds of link the server keeps (CreditRules.LinkKinds), as the page names them, in its order. */
        val LINKS = listOf("official" to "Official site", "wikipedia" to "Wikipedia", "wikidata" to "Wikidata", "discogs" to "Discogs",
            "allmusic" to "AllMusic", "bandcamp" to "Bandcamp", "lastfm" to "Last.fm", "soundcloud" to "SoundCloud", "youtube" to "YouTube")

        /** Their years: "1982–1987"; a person's "1946–2016" or "born 1946"; a band "since 1982", or "1982–" when it ended unsaid. */
        fun years(begin: String?, end: String?, ended: Boolean, type: String?): String? {
            val from = begin?.take(4); val to = end?.take(4)
            return when {
                from != null && to != null -> "$from–$to"
                from != null && type == "Person" -> if (ended) "$from–" else "born $from"
                from != null -> if (ended) "$from–" else "since $from"
                to != null -> "until $to"
                else -> null
            }
        }

        private fun stint(j: JSONObject) = Stint(j.optString("name", ""), j.str("begin"), j.str("end"), j.optBoolean("ended", false),
            j.optJSONArray("roles").strings(), j.str("photo_key"), j.optBoolean("in_library", false))

        fun parse(j: JSONObject): ArtistAbout {
            val links = j.optJSONObject("links")
            return ArtistAbout(
                name = j.optString("name", ""), known = j.optBoolean("known", false), mbid = j.str("mbid"), type = j.str("type"), photoKey = j.str("photo_key"),
                disambiguation = j.str("disambiguation"), begin = j.str("begin"), end = j.str("end"), ended = j.optBoolean("ended", false), area = j.str("area"),
                links = links?.keys()?.asSequence()?.mapNotNull { k -> links.str(k)?.let { k to it } }?.toMap() ?: emptyMap(),
                members = j.optJSONArray("members").items(::stint), memberOf = j.optJSONArray("member_of").items(::stint),
                creditedOn = j.optJSONArray("credited_on").items { Credited(AlbumSummary.parse(it), it.optJSONArray("roles").strings()) },
                bandAlbums = j.optJSONArray("band_albums").items { BandAlbums(it.optString("band", ""), it.optJSONArray("albums").items(AlbumSummary::parse)) }
                    .filter { it.band.isNotEmpty() && it.albums.isNotEmpty() },
                genres = j.optJSONArray("genres").strings()
            )
        }
    }
}
