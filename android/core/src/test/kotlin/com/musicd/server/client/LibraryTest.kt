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
