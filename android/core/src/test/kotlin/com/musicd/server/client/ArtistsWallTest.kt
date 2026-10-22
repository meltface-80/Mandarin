package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Artists wall (item 130): its pages, orders, find and pictures. */
class ArtistsWallTest {
    @Test fun `a page asked in its order, at random with its seed, found by part of a name`() {
        assertEquals("/api/artists?sort=az&offset=0&limit=120", ArtistsWall.path("az", 0))
        assertEquals("/api/artists?sort=albums&offset=240&limit=120", ArtistsWall.path("albums", 240))
        assertEquals("/api/artists?sort=random&offset=0&limit=120&seed=7", ArtistsWall.path("random", 0, seed = 7))
        assertEquals("/api/artists?sort=az&offset=0&limit=120&q=sigur%20r%C3%B3s", ArtistsWall.path("az", 0, " sigur rós "))
        // An order it doesn't know is A to Z; never a negative offset.
        assertEquals("/api/artists?sort=az&offset=0&limit=120", ArtistsWall.path("plays", -5))
    }

    @Test fun `Sort goes round the three orders and says each`() {
        assertEquals(listOf("albums", "random", "az"), listOf("az", "albums", "random").map(ArtistsWall::nextSort))
        assertEquals("albums", ArtistsWall.nextSort("nonsense"))
        assertEquals(listOf("A–Z", "Most albums", "Random"), ArtistsWall.SORTS.map(ArtistsWall::sortWord))
    }

    @Test fun `their own picture once found, else their first album's cover`() {
        val p = ArtistPage.parse(JSONObject("""{"artists":[
            {"name":"Björk","albumCount":3,"image_key":"al-11-abc","photo_key":"u-aHR0cHM6Ly9leGFtcGxlLmNvbS9iLmpwZw"},
            {"name":"Yes","albumCount":1,"image_key":"al-9-def"}],"offset":0,"total":2}"""))
        assertEquals("u-aHR0cHM6Ly9leGFtcGxlLmNvbS9iLmpwZw", ArtistsWall.art(p.artists[0]))
        assertEquals("al-9-def", ArtistsWall.art(p.artists[1]))
        assertNull(p.artists[1].photoKey)
        assertEquals(listOf("3 albums", "1 album"), p.artists.map(ArtistsWall::subtitle))
        assertEquals("Artists · 2", ArtistsWall.heading(p.total))
        assertEquals("Artists", ArtistsWall.heading(null))
        assertTrue(ArtistsWall.more(120, 4304))
        assertFalse(ArtistsWall.more(4304, 4304))
        assertEquals("No artist matches “zz”", ArtistsWall.none(" zz "))
        assertEquals("artists?zone=z%201", ShellRoute.artists("z 1"))
    }
}
