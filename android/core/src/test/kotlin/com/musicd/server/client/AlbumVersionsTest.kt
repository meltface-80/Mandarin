package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** An album's versions as the server answers them (item 345): the tile's mark, the page's pills and Make main's words. */
class AlbumVersionsTest {
    @Test fun `a tile says how many versions its album has, one of one says nothing`() {
        val main = AlbumSummary.parse(JSONObject("""{"offset":7,"title":"Metallic 'KO (2015 Remaster)","subtitle":"Iggy and The Stooges","versions":2,"version":"2015 Remaster · 24/96"}"""))
        assertEquals(2, main.versions)
        assertEquals("2015 Remaster · 24/96", main.version)
        assertEquals("2 versions", AlbumVersion.mark(main))
        assertNull(AlbumVersion.mark(AlbumSummary.parse(JSONObject("""{"offset":8,"title":"Peter Gabriel"}"""))))
    }

    @Test fun `an album's page lists its versions, the main first and marked, the one open known`() {
        val a = Album.parse(JSONObject("""{"album":{"offset":3,"title":"Metallic 'KO","subtitle":"Iggy and The Stooges","versions":2,"version":"Original · 16/44.1"},
            "versions":[{"offset":7,"title":"Metallic 'KO (2015 Remaster)","label":"2015 Remaster · 24/96","main":true,"current":false},
                        {"offset":3,"title":"Metallic 'KO","label":"Original · 16/44.1","main":false,"current":true}]}"""))
        assertEquals(listOf("2015 Remaster · 24/96 · Main", "Original · 16/44.1"), a.versions.map { it.words })
        assertEquals(listOf(7L, 3L), a.versions.map { it.album.offset })
        assertTrue(a.versions[1].current)
        assertEquals("2 versions", AlbumVersion.head(a.versions.size))
        assertTrue(Album.parse(JSONObject("""{"album":{"offset":1,"title":"x"}}""")).versions.isEmpty())
        assertEquals("Make this the main version", AlbumVersion.MAKE_MAIN)
    }

    @Test fun `a version's row says its edition, its rate, its tracks, length and year, and the page keeps its title (item 349)`() {
        val a = Album.parse(JSONObject("""{"album":{"offset":3,"title":"Metallic 'KO (2015 Remaster)","base_title":"Metallic 'KO","versions":2},
            "versions":[{"offset":7,"title":"Metallic 'KO (2015 Remaster)","quality":"24/96","edition":"2015 Remaster","tracks":12,"seconds":2625,"release_year":2015,"label":"2015 Remaster · 24/96","main":true,"current":true},
                        {"offset":3,"title":"Metallic 'KO","quality":"16/44.1","year":1976,"edition":null,"tracks":1,"seconds":null,"label":"16/44.1","main":false,"current":false}]}"""))
        assertEquals("Metallic 'KO", a.album.baseTitle)
        val (main, other) = a.versions
        assertEquals(listOf("2015 Remaster", "24-bit / 96 kHz", "12 tracks · 43:45 · 2015"), listOf(main.name, main.format, main.facts))
        assertEquals(listOf("Metallic 'KO", "16-bit / 44.1 kHz", "1 track · 1976"), listOf(other.name, other.format, other.facts))
        assertEquals(listOf("Tracks", "Credits", "About", "Versions"), Contract.labels["album.tab"])
        assertEquals(listOf("Version actions"), Contract.labels["album.version-more"])
    }
}
