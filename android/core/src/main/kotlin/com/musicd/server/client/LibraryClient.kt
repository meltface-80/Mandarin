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

    /**
     * A page of the library's albums, as the Library wall lists them: [count] from [offset], in the wall's [view]
     * (the page's query string: the sort and its direction, the focus; "" for the library as it is).
     */
    fun albums(offset: Int = 0, count: Int = 60, view: String = ""): AlbumPage =
        AlbumPage.parse(get("/api/library/albums" + (if (offset > 0) "?offset=$offset&count=$count" else "?count=$count") + (if (view.isEmpty()) "" else "&$view")))

    /** An album's page, by its [offset] (the id every list gives it). */
    fun album(offset: Long): Album = Album.parse(get("/api/album?offset=$offset"))

    /** What its page shows under its artists: date, label, score (the day looked up when only the year is known). */
    fun albumExtras(title: String, artist: String): AlbumExtras = AlbumExtras.parse(get("/api/album/extras?title=" + enc(title) + "&artist=" + enc(artist) + "&day=1"))

    fun artists(): ArtistPage = ArtistPage.parse(get("/api/artists"))

    fun artistAlbums(artist: String): ArtistAlbums = ArtistAlbums.parse(get("/api/artist-albums?artist=" + enc(artist)))

    /** The album's booklets, the PDFs in its folder (only an album of your own files has any). */
    fun booklets(offset: Long): List<Booklet> = Booklet.list(get("/api/album/booklets?offset=$offset"))

    /** Last.fm's artists like [artist], for the row under an album's tracks (not enabled without a key). */
    fun similarArtists(artist: String): SimilarArtists = SimilarArtists.parse(get("/api/lastfm/similar-artists?artist=" + enc(artist)))

    /** Last.fm's albums like [artist]'s, likewise. */
    fun similarAlbums(artist: String): SimilarAlbums = SimilarAlbums.parse(get("/api/lastfm/similar-albums?artist=" + enc(artist)))

    fun search(query: String): SearchResults = SearchResults.parse(get("/api/search?q=" + enc(query)))

    /** The search beyond the library (item 61): one [part] of it ("qobuz", "tidal", "pitchfork"), each asked on its own as the page asks. */
    fun searchExternal(query: String, part: String): ExternalSearch = ExternalSearch.parse(get("/api/search/external?q=" + enc(query) + "&parts=" + enc(part)))

    /** Home's rows in the owner's order, each on or off. */
    fun homeRows(): List<HomeRow> = HomeRows.parse(get("/api/settings/home-rows"))

    /** Recently played: the albums played in the last 30 days, the latest first. */
    fun recentlyPlayed(): AlbumRow = AlbumRow.parse(get("/api/home/history"))

    /** Not played: the albums not played for months. */
    fun notPlayed(): AlbumRow = AlbumRow.parse(get("/api/home/unplayed"))

    /** The Focus sheet's facets (item 52). */
    fun facets(): Facets = Facets.parse(get("/api/library/facets"))

    /** The walls Home links to (item 52): Favourites, Listen later, Recently played (the last 30 days, [count] at most), Not played in [months] ([count] at most). */
    fun favourites(): AlbumRow = AlbumRow.parse(get("/api/favourites"))
    fun listenLater(): AlbumRow = AlbumRow.parse(get("/api/listen-later"))
    fun history(count: Int): AlbumRow = AlbumRow.parse(get("/api/home/history?count=$count"))
    fun unplayed(months: Int, count: Int): Unplayed = Unplayed.parse(get("/api/home/unplayed?months=$months&count=$count"))
    /** Random albums, [count] of them (the random wall; asked again to reshuffle). */
    fun randomAlbums(count: Int): AlbumRow = AlbumRow.parse(get("/api/random-albums?count=$count"))

    /** An artist's biography, one of their albums naming them ([album]); null when there is none. */
    fun artistBio(artist: String, album: String): ArtistBio? = ArtistBio.parse(get("/api/artist-bio?artist=" + enc(artist) + "&album=" + enc(album)))

    fun albumOfTheDay(): AlbumOfTheDay = AlbumOfTheDay.parse(get("/api/home/album-of-the-day"))

    /** Home's other rows (item 57): today's Smart Picks; the genres and their groups, as the Browse by genre cards; the label of the week; the playlists' tiles. */
    fun smartPicks(): SmartPicks = SmartPicks.parse(get("/api/smart-picks"))
    fun genres(): List<Genre> = Genre.list(get("/api/filters/genres"))
    fun genreGroups(): GenreGroups = GenreGroups.parse(get("/api/home/genre-groups"))
    fun genreCards(): List<GenreCard> = GenreCard.build(genres(), genreGroups())
    fun labelOfTheWeek(): LabelOfTheWeek = LabelOfTheWeek.parse(get("/api/home/label-of-the-week"))
    fun playlists(): List<PlaylistTile> = PlaylistTile.mine(get("/api/user-playlists")) + PlaylistTile.smart(get("/api/smart-playlists"))
    /** Your playlists, the last changed first (the Playlists screen, item 65), and one of them with its tracks. */
    fun userPlaylists(): List<PlaylistTile> = PlaylistTile.mine(get("/api/user-playlists"))
    fun userPlaylist(id: String): UserPlaylist = UserPlaylist.parse(get("/api/user-playlist?id=" + enc(id)))

    /** The Dynamic Playlists (item 66); a tracks one's tracks from album [offset] on; an albums one's albums ([max] at most, else its own size). */
    fun smartPlaylists(): List<SmartPlaylist> = SmartPlaylist.list(get("/api/smart-playlists"))
    fun smartTracks(id: String, offset: Int, zoneId: String): SmartTracks =
        SmartTracks.parse(get("/api/smart-playlist?id=" + enc(id) + "&offset=$offset" + (if (zoneId.isEmpty()) "" else "&zone=" + enc(zoneId))))
    fun smartAlbums(id: String, max: Int? = null): SmartAlbums = SmartAlbums.parse(get("/api/smart-playlist/albums?id=" + enc(id) + (if (max == null) "" else "&max=$max")))

    /** Random Album's choice, to be offered (Play now, Play next, Queue). */
    fun pickUnheard(): PickedAlbum = PickedAlbum.parse(get("/api/pick-unheard"))
    /** Random albums narrowed by [filter] (a genre's wall from Browse by genre), [count] of them; [total] in the answer is the pool's. */
    fun randomAlbums(count: Int, filter: WallFilter): AlbumRow = AlbumRow.parse(get("/api/random-albums?count=$count" + filter.query()))

    // A space as %20, as a browser's address has it ("+" means a space only in a form's body).
    /** The record labels (item 71), one label's albums in its order ("alpha" or "random"), and the logos Discogs has for it. */
    fun labels(): LabelList = LabelList.parse(get("/api/filters/labels"))
    fun labelAlbums(name: String, order: String): LabelAlbums = LabelAlbums.parse(get("/api/label-albums?label=" + enc(name) + "&order=" + enc(order)))
    fun labelLogoCandidates(name: String): List<LogoCandidate> = LogoCandidate.list(get("/api/labels/logo-candidates?label=" + enc(name)))

    /** Pitchfork's Latest Reviews or Best New Music (item 70), and the library's album a review is of. */
    fun pitchforkReviews(type: String): List<PitchforkHit> = PitchforkHit.list(get("/api/pitchfork/reviews?type=" + enc(type)))
    fun pitchforkMatch(r: PitchforkHit): Long? = PitchforkHit.match(get("/api/pitchfork/review?url=" + enc(r.url) + "&album=" + enc(r.album) + "&artist=" + enc(r.artist)))

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
