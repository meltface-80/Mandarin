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

    @Test fun `every answer recorded is one the client asks for`() {
        client.albums(); client.album(client.albums().albums.first { it.title == "Album One" }.offset); client.artists()
        client.artistAlbums("Artist A"); client.search("album"); client.homeRows(); client.recentlyPlayed(); client.notPlayed(); client.albumOfTheDay()
        val recorded = golden.keySet().map { golden.getJSONObject(it).getString("path") }.toSet()
        assertEquals(recorded, asked.toSet())
    }
}
