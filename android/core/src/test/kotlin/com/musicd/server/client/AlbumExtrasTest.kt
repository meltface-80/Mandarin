package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class AlbumExtrasTest {
    @Test fun `the date as the page writes it, in the phone's language`() {
        assertEquals("20 November 2006", ReleaseDate.format("2006-11-20", Locale.UK))
        assertEquals("November 20, 2006", ReleaseDate.format("2006-11-20", Locale.US))
        assertEquals("November 2006", ReleaseDate.format("2006-11", Locale.UK))
        assertEquals("2006", ReleaseDate.format("2006", Locale.UK))
        assertEquals("no such day: the year", "2026", ReleaseDate.format("2026-13-40", Locale.UK))
        assertEquals("", ReleaseDate.format("soon", Locale.UK))
        assertEquals("", ReleaseDate.format(null, Locale.UK))
    }

    @Test fun `the extras read, date, label, score`() {
        val e = AlbumExtras.parse(JSONObject("""{"release_date": "2006-11-20", "year": "2006", "album": {"label": "RCA", "score": 8, "isBestNewMusic": true}}"""))
        assertEquals("20 November 2006", e.date(Locale.UK))
        assertEquals(listOf("RCA", "8.0"), listOf(e.label, e.scoreText))
        assertTrue(e.bestNewMusic)
        val bare = AlbumExtras.parse(JSONObject("""{"album": {"year": 1997}}"""))
        assertEquals("the year when that is all", "1997", bare.date(Locale.UK))
        assertNull(bare.label); assertNull(bare.scoreText); assertFalse(bare.bestNewMusic)
        assertEquals("7.4", AlbumExtras(null, null, null, 7.4, false).scoreText)
        // A label the server has as null is no label (Android's org.json would read it as the word "null").
        val unlabelled = AlbumExtras.parse(JSONObject("""{"release_date": null, "year": null, "album": {"label": null, "year": 2024, "score": null}}"""))
        assertNull(unlabelled.label); assertNull(unlabelled.releaseDate); assertNull(unlabelled.scoreText)
        assertEquals("2024", unlabelled.date(Locale.UK))
        assertEquals("", AlbumExtras.parse(JSONObject("{}")).date(Locale.UK))
    }

    @Test fun `the album's length, and its marks`() {
        val t = listOf(Track(1, "a", "", 183.4, null), Track(2, "b", "", 2638.0, null))
        assertEquals("47:01", albumLength(t))
        assertEquals("", albumLength(emptyList()))
        val a = AlbumSummary.parse(JSONObject("""{"offset": 3, "title": "Album One", "favourite": true, "hires": true}"""))
        assertEquals(listOf(true, false, true), listOf(a.favourite, a.later, a.hires))
        assertEquals(listOf("", "0:03"), Track(5, "Song 1", "", 3.0, null).copy(subtitle = "0:03").let { listOf(it.sub, it.lengthText) })
        assertEquals(listOf("Artist B · Live", "4:05"), Track(5, "x", "Artist B · Live · 4:05", 245.0, null).let { listOf(it.sub, it.lengthText) })
        assertEquals("no length: all of it", listOf("Artist B", ""), Track(5, "x", "Artist B", 0.0, null).let { listOf(it.sub, it.lengthText) })
    }
}
