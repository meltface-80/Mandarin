package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The typed client (LibraryClient) answered as the C# server answers, on the
 * test suite's own library: test/golden/android-api.json, recorded and kept by
 * the server's AndroidApiTests. Each call must ask the path recorded and read
 * what came back; a server that changes an answer changes that file, and this
 * reads it again.
 */
class LibraryTest {
    private val golden: JSONObject by lazy {
        val f = listOf("../../test/golden/android-api.json", "../test/golden/android-api.json", "test/golden/android-api.json")
            .map { File(it) }.first { it.exists() }
        JSONObject(f.readText())
    }

    private val asked = ArrayList<String>()

    /** The client, each path answered from the recording: one never recorded fails. */
    private val client = LibraryClient { path ->
        asked += path
        val hit = golden.keySet().map { golden.getJSONObject(it) }.firstOrNull { it.getString("path") == path }
        requireNotNull(hit) { "asked $path, which the server's answers (android-api.json) don't have" }.getJSONObject("answer")
    }

    @Test fun `the library's albums, a page of them`() {
        val p = client.albums()
        assertEquals(3, p.total)
        assertEquals(listOf("Album One", "Best Of", "Hi Res"), p.albums.map { it.title })
        val one = p.albums[0]
        assertEquals("Artist A", one.subtitle)
        assertEquals(1997, one.year)
        assertEquals("16/44.1", one.quality)
        assertNull("the library's own", one.source)
        assertTrue(one.imageKey!!.isNotEmpty())
        assertEquals("a box of two discs", 2, p.albums[1].discs)
        assertNull("no year given", p.albums[1].year)
    }

    @Test fun `an album's page, its tracks, genres and what can be done with it`() {
        val first = client.albums().albums.first { it.title == "Album One" }
        val a = client.album(first.offset)
        assertEquals(first.offset, a.album.offset)
        assertEquals(listOf("Song 1", "Song 2", "Song 3"), a.tracks.map { it.title })
        assertEquals(3.0, a.tracks[0].length, 0.0)
        assertEquals("0:03", a.tracks[0].subtitle)
        assertTrue(a.tracks.map { it.id }.distinct().size == 3)
        assertEquals(listOf("Rock"), a.genres)
        assertEquals(listOf("Artist A"), a.artists)
        assertTrue(a.actions.map { it.kind }.containsAll(listOf("play_now", "queue", "play_next")))
        assertFalse(a.partial)
    }

    @Test fun `a classical album's works and the names for its head`() {
        val a = Album.parse(JSONObject("""{"album":{"offset":7,"title":"Violin Concertos","subtitle":"Anne-Sophie Mutter","composers":["Ludwig van Beethoven","Johannes Brahms"],
            "conductor":"Herbert von Karajan","performers":["Anne-Sophie Mutter (violin)","Berliner Philharmoniker"]},
            "tracks":[{"track_id":1,"title":"A","subtitle":"25:40","length":1540},{"track_id":2,"title":"B","subtitle":"11:04","length":664},{"track_id":3,"title":"C","subtitle":"8:17","length":497}],
            "works":[{"title":"Violin Concerto in D major, Op. 61","composer":"Ludwig van Beethoven","conductor":"Herbert von Karajan","performers":["Anne-Sophie Mutter (violin)"],"disc":1,"length":2204,
              "movements":[{"track":0,"title":"I. Allegro ma non troppo"},{"track":1,"title":"II. Larghetto"}]},
              {"title":null,"composer":null,"conductor":null,"performers":[],"disc":2,"length":497,"movements":[{"track":2,"title":"C"}]}]}"""))
        assertTrue(a.classical)
        assertEquals(listOf("Ludwig van Beethoven", "Johannes Brahms"), a.composers)
        assertEquals("Herbert von Karajan", a.conductor)
        assertEquals(listOf("Anne-Sophie Mutter (violin)", "Berliner Philharmoniker"), a.performers)
        assertEquals(2, a.works.size)
        assertEquals("Violin Concerto in D major, Op. 61", a.works[0].title)
        assertEquals(listOf(0 to "I. Allegro ma non troppo", 1 to "II. Larghetto"), a.works[0].movements.map { it.track to it.title })
        assertEquals(1L, a.works[0].disc)
        assertEquals(2204.0, a.works[0].length, 0.0)
        // A plain track among the works: no title, the track's own name; the null the server writes stays a null, not "null".
        assertEquals(null, a.works[1].title)
        assertEquals(null, a.works[1].composer)
        // An album with none: not classical, nothing named.
        val plain = Album.parse(JSONObject("""{"album":{"offset":1,"title":"Album One","subtitle":"Artist A"},"tracks":[]}"""))
        assertFalse(plain.classical)
        assertEquals(emptyList<String>(), plain.composers)
        assertEquals(null, plain.conductor)
    }

    @Test fun `artists, and an artist's albums`() {
        val p = client.artists()
        assertEquals(listOf("Artist A", "Artist B"), p.artists.map { it.name })
        assertEquals(1, p.artists[0].albumCount)
        val aa = client.artistAlbums("Artist A")
        assertEquals("Artist A", aa.artist)
        assertEquals(listOf("Album One"), aa.primary.map { it.title })
        assertTrue(aa.featured.isEmpty())
    }

    @Test fun `the library searched`() {
        val r = client.search("album")
        assertEquals("album", r.query)
        assertEquals(listOf("Album One"), r.albums.map { it.title })
    }

    @Test fun `Home's rows, Recently played, Not played and the album of the day`() {
        val rows = client.homeRows()
        assertTrue(rows.map { it.id }.containsAll(listOf("history", "unplayed", "favourites", "random")))
        assertEquals("Record labels is off in Settings", rows.first { it.id == "lotw" }.unavailable)
        assertNull(rows.first { it.id == "history" }.unavailable)
        assertTrue("nothing played yet", client.recentlyPlayed().albums.isEmpty())
        assertTrue(client.notPlayed().albums.isEmpty())
        val day = client.albumOfTheDay()
        assertFalse(day.played)
        assertTrue(day.day.isNotEmpty())
        assertTrue(day.album!!.title in client.albums().albums.map { it.title })
    }

    @Test fun `Home's other rows, Smart Picks, the genre cards, the label of the week, the playlists, Random Album's choice`() {
        val sp = client.smartPicks()
        assertTrue(sp.enabled); assertTrue(sp.serviceReady); assertFalse(sp.building); assertNull(sp.error)
        // The least played of the library, a compilation left out; each one the library's, so it opens as an album.
        assertEquals(listOf("Album One", "Hi Res"), sp.picks.map { it.album })
        assertEquals(listOf("Artist A", "Artist B"), sp.picks.map { it.artist })
        assertEquals("Never played here", sp.picks[0].reason)
        assertEquals(3L, sp.picks[0].inLibrary!!.offset)
        assertEquals("Artist A", sp.picks[0].inLibrary!!.subtitle)
        assertFalse(sp.picks[0].added)
        assertNull(sp.picks[0].albumId)
        assertEquals(listOf("Jazz", "Rock"), client.genres().map { it.title })
        assertEquals("1 album", client.genres()[0].subtitle)
        val groups = client.genreGroups()
        assertNull("the C# server's are flat", groups.parent)
        assertEquals(listOf("Rock"), groups.rockmetal.map { it.title })
        assertEquals(listOf("Jazz", "Rock"), client.genreCards().map { it.label })
        assertEquals(WallFilter("genre", "Rock"), client.genreCards()[1].filter())
        val lotw = client.labelOfTheWeek()
        assertNull("no label of three albums", lotw.label); assertTrue(lotw.albums.isEmpty())
        assertTrue(client.playlists().isEmpty())
        assertTrue(client.favourites().albums.isEmpty()); assertTrue(client.listenLater().albums.isEmpty())
        assertEquals("Album One", client.pickUnheard().album.title)
    }

    @Test fun `the genre cards as the page builds them, the groups first, the parent left out, twelve at most and even`() {
        val genres = (1..15).map { Genre("Genre $it", "", 20 - it) } + Genre("Pop/Rock", "", 1)
        val groups = GenreGroups("Pop/Rock", listOf(GenreSub("Synth-pop", 3)), listOf(GenreSub("Metal", 9), GenreSub("Punk", 1)))
        val cards = GenreCard.build(genres, groups)
        assertEquals(12, cards.size)
        assertEquals(listOf("Rock/Metal", "Pop", "Genre 1"), cards.take(3).map { it.label })
        assertEquals(WallFilter("genre", "Synth-pop", "Pop/Rock", "Pop"), cards[1].filter())
        assertEquals("Pop", cards[1].filter().title)
        assertEquals("&filter_type=genre&filter_value=Synth-pop&filter_parent=Pop%2FRock", cards[1].filter().query())
        assertEquals(cards[1].filter(), WallFilter.parse(WallFilter.routeQuery(cards[1].filter())))
        // The commoner sub-genre the likelier: Metal nine times in ten.
        assertEquals("Metal", cards[0].filter(kotlin.random.Random(1)).value)
        assertEquals(listOf("Rock/Metal", "Pop", "Genre 1", "Genre 2"), GenreCard.build(genres.take(3), groups).map { it.label })
        // An odd count loses its last; the parent alone (no groups) is a card of its own.
        assertEquals(listOf("Genre 1", "Genre 2"), GenreCard.build(genres.take(3), GenreGroups(null, emptyList(), emptyList())).map { it.label })
        assertEquals(listOf("Genre 1", "Pop/Rock"), GenreCard.build(listOf(genres[0], genres[15]), GenreGroups(null, emptyList(), emptyList())).map { it.label })
        assertNull(WallFilter.parse(""))
    }

    @Test fun `a playlist's tile, its second line as the page writes it, yours the last changed first`() {
        val mine = PlaylistTile.mine(JSONObject("""{"playlists":[{"id":"a","name":"Old","track_total":1,"updated_at":5,"art_keys":["k1"]},{"id":"b","name":"New","track_total":12,"updated_at":9,"art_keys":[]}]}"""))
        assertEquals(listOf("New", "Old"), mine.map { it.name })
        assertEquals(listOf("12 tracks", "1 track"), mine.map { it.subtitle })
        assertEquals(listOf("k1"), mine[1].artKeys)
        val smart = PlaylistTile.smart(JSONObject("""{"playlists":[{"id":"s","name":"Dyn","count":1,"matched":40,"art_keys":["x","y"]}]}"""))
        assertEquals("Dynamic · 1 album", smart[0].subtitle)
        assertTrue(smart[0].smart)
    }

    @Test fun `Music on device's view, its sorts, its Focus on the phone's own facets, kept as JSON`() {
        val a = AlbumSummary(-1, "Beta", "Zed", "phone-a", "24/96", 1995, null, "local", hires = true)
        val b = AlbumSummary(-2, "alpha", "Amy", null, "MP3", null, null, "local")
        val c = AlbumSummary(-3, "Gamma", "", null, "16/44.1", 2003, null, "local")
        val v = LocalView()
        assertEquals(listOf("alpha", "Beta", "Gamma"), v.sorted(listOf(a, b, c)).map { it.title })
        assertEquals(listOf("Gamma", "Beta", "alpha"), v.copy(dir = "desc").sorted(listOf(a, b, c)).map { it.title })
        assertEquals("no artist first, as the page sorts it", listOf("", "Amy", "Zed"), v.choose("artist").sorted(listOf(a, b, c)).map { it.subtitle })
        assertEquals("Newest first", v.choose("year").dirLabel)
        assertEquals(listOf("Gamma", "Beta", "alpha"), v.choose("year").sorted(listOf(a, b, c)).map { it.title })
        // Random: the same shuffle for the same seed, another on a second tap.
        val r = v.choose("random")
        assertEquals(r.sorted(listOf(a, b, c)), r.sorted(listOf(a, b, c)))
        assertTrue(r.choose("random").seed != r.seed)
        assertEquals("", r.dirLabel)
        assertEquals(listOf("Zed", "1990s", "Hi-Res"), LocalView.FACETS.map { (id, _) -> LocalView.facetOf(id, a) })
        assertEquals(listOf("Unknown artist", "2000s", "Lossless"), LocalView.FACETS.map { (id, _) -> LocalView.facetOf(id, c) })
        assertEquals("Undated", LocalView.facetOf("decade", b))
        assertEquals("Lossy", LocalView.facetOf("quality", b))
        val f = v.cycle("decade", "1990s")
        assertEquals(listOf(true, false, false), listOf(a, b, c).map(f::passes))
        assertEquals(listOf(false, true, true), listOf(a, b, c).map(f.cycle("decade", "1990s")::passes))
        assertEquals(1, f.focusCount); assertEquals("on", f.state("decade", "1990s")); assertEquals("not", f.cycle("decade", "1990s").state("decade", "1990s"))
        assertEquals(0, f.cycle("decade", "1990s").cycle("decade", "1990s").focusCount)
        assertEquals(f.choose("year"), LocalView.parse(f.choose("year").toJson()))
        assertEquals(LocalView(), LocalView.parse("nonsense"))
    }

    @Test fun `every answer recorded is one the client asks for`() {
        client.albums(); client.album(client.albums().albums.first { it.title == "Album One" }.offset); client.artists()
        client.artistAlbums("Artist A"); client.search("album"); client.homeRows(); client.recentlyPlayed(); client.notPlayed(); client.albumOfTheDay()
        client.smartPicks(); client.genreCards(); client.labelOfTheWeek(); client.playlists(); client.favourites(); client.listenLater(); client.pickUnheard()
        val recorded = golden.keySet().map { golden.getJSONObject(it).getString("path") }.toSet()
        assertEquals(recorded, asked.toSet())
    }
}
