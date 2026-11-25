package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Android Auto's shelves (item 533): their order, the server's answers read, and the kept ones. */
class AutoShelfTest {
    @Test fun `the top level in the owner's order, Random albums first, with no server, Downloaded albums alone`() {
        assertEquals(listOf("random", "picks", "downloads"), AutoShelf.root(true).map { it.first })
        assertEquals(listOf("Random albums", "Smart Picks", "Downloaded albums"), AutoShelf.root(true).map { it.second })
        assertEquals(listOf("downloads"), AutoShelf.root(false).map { it.first })
    }

    @Test fun `each shelf read from its own answer`() {
        assertEquals("/api/random-albums?count=20", AutoShelf.path(AutoShelf.RANDOM))
        assertEquals("/api/smart-picks", AutoShelf.path(AutoShelf.PICKS))
        val random = JSONObject("""{"albums":[{"offset":7,"title":"Lunatics","subtitle":"Francesco D'auria","image_key":"al-7-ab"},{"title":"no offset"}]}""")
        assertEquals(listOf(AutoShelf.Album(7, "Lunatics", "Francesco D'auria", "al-7-ab")), AutoShelf.parse(AutoShelf.RANDOM, random))
        val picks = JSONObject("""{"picks":[{"offset":9,"album":"Meddle","artist":"Pink Floyd","image_key":"al-9-cd","why":"x"}]}""")
        assertEquals(listOf(AutoShelf.Album(9, "Meddle", "Pink Floyd", "al-9-cd")), AutoShelf.parse(AutoShelf.PICKS, picks))
        assertEquals(emptyList<AutoShelf.Album>(), AutoShelf.parse(AutoShelf.PICKS, random))
    }

    @Test fun `a shelf kept and read back as it was, anything else is none`() {
        val albums = listOf(AutoShelf.Album(7, "Lunatics", "F", "al-7-ab"), AutoShelf.Album(9, "Meddle", "Pink Floyd", ""))
        assertEquals(1234L to albums, AutoShelf.kept(AutoShelf.keep(albums, 1234)))
        assertNull(AutoShelf.kept(null))
        assertNull(AutoShelf.kept("not json"))
        assertNull(AutoShelf.kept("""{"albums":[]}"""))
    }

    @Test fun `a kept shelf read again once ten minutes old, or when the clock went back`() {
        val at = 1_000_000L
        assertFalse(AutoShelf.due(at, at + AutoShelf.REFRESH_MS))
        assertTrue(AutoShelf.due(at, at + AutoShelf.REFRESH_MS + 1))
        assertTrue(AutoShelf.due(at, at - 1))
    }
}
