package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** An album's credits (item 132): who, their parts, and which tracks when not all. */
class AlbumCreditsTest {
    @Test fun `the credits in the server's order, each with their parts and tracks`() {
        val c = AlbumCredits.parse(JSONObject("""{"album":3,"status":"musicbrainz","credits":[
            {"name":"Jerome Augustyniak","roles":["Drums"],"tracks":null,"photo_key":null,"in_library":false},
            {"name":"Dennis Drew","roles":["Organ"],"tracks":[1],"photo_key":"u-eA","in_library":true},
            {"name":"Natalie Merchant","roles":["Lead vocals","Composer"],"tracks":[5,1,2,3],"in_library":false},
            {"name":"","roles":["Nobody"]}]}"""))
        assertEquals("musicbrainz", c.status)
        assertEquals(listOf("Jerome Augustyniak", "Dennis Drew", "Natalie Merchant"), c.credits.map { it.name })
        assertNull(c.credits[0].tracks)
        assertEquals("Drums", c.credits[0].line)
        assertEquals("Organ · track 1", c.credits[1].line)
        assertEquals("Lead vocals, Composer · tracks 1–3, 5", c.credits[2].line)
        assertEquals("u-eA", c.credits[1].photoKey)
        assertTrue(c.credits[1].inLibrary)
        assertFalse(c.credits[0].inLibrary)
    }

    @Test fun `track lists, runs of three or more a range`() {
        assertEquals("tracks 1, 2", AlbumCredits.trackList(listOf(2, 1)))
        assertEquals("tracks 1–4, 7, 9–11", AlbumCredits.trackList(listOf(1, 2, 3, 4, 7, 9, 10, 11, 3)))
        assertNull(AlbumCredits.trackList(emptyList()))
        assertTrue(AlbumCredits.parse(JSONObject("""{"status":"none"}""")).credits.isEmpty())
    }
}
