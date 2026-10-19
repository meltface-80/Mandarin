package com.musicd.server.client

import org.json.JSONObject
import java.net.URLEncoder

/**
 * The library's calls, typed (stage N1 of docs/specs/plan-android-native.md):
 * what the native screens will ask, each answer as its model (Library.kt).
 * [get] is the server's GET of a path, its answer as JSON; a [ServerClient]'s
 * by default, the recorded answers in the tests (LibraryTest).
 */
class LibraryClient(private val get: (String) -> JSONObject) {
    constructor(server: ServerClient) : this({ path -> server.getJson(path) })

    /** A page of the library's albums, as the Library wall lists them: [count] from [offset]. */
    fun albums(offset: Int = 0, count: Int = 60): AlbumPage =
        AlbumPage.parse(get("/api/library/albums" + (if (offset > 0) "?offset=$offset&count=$count" else "?count=$count")))

    /** An album's page, by its [offset] (the id every list gives it). */
    fun album(offset: Long): Album = Album.parse(get("/api/album?offset=$offset"))

    /** What its page shows under its artists: date, label, score (the day looked up when only the year is known). */
    fun albumExtras(title: String, artist: String): AlbumExtras = AlbumExtras.parse(get("/api/album/extras?title=" + enc(title) + "&artist=" + enc(artist) + "&day=1"))

    fun artists(): ArtistPage = ArtistPage.parse(get("/api/artists"))

    fun artistAlbums(artist: String): ArtistAlbums = ArtistAlbums.parse(get("/api/artist-albums?artist=" + enc(artist)))

    /** Last.fm's artists like [artist], for the row under an album's tracks (not enabled without a key). */
    fun similarArtists(artist: String): SimilarArtists = SimilarArtists.parse(get("/api/lastfm/similar-artists?artist=" + enc(artist)))

    /** Last.fm's albums like [artist]'s, likewise. */
    fun similarAlbums(artist: String): SimilarAlbums = SimilarAlbums.parse(get("/api/lastfm/similar-albums?artist=" + enc(artist)))

    fun search(query: String): SearchResults = SearchResults.parse(get("/api/search?q=" + enc(query)))

    /** Home's rows in the owner's order, each on or off. */
    fun homeRows(): List<HomeRow> = HomeRows.parse(get("/api/settings/home-rows"))

    /** Recently played: the albums played in the last 30 days, the latest first. */
    fun recentlyPlayed(): AlbumRow = AlbumRow.parse(get("/api/home/history"))

    /** Not played: the albums not played for months. */
    fun notPlayed(): AlbumRow = AlbumRow.parse(get("/api/home/unplayed"))

    fun albumOfTheDay(): AlbumOfTheDay = AlbumOfTheDay.parse(get("/api/home/album-of-the-day"))

    // A space as %20, as a browser's address has it ("+" means a space only in a form's body).
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
