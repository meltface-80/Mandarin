package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** An act's similar acts (item 137): where from, each with whether the library has them and a picture. */
class ArtistSimilarTest {
    @Test fun `similar acts read, those without a name left out`() {
        val s = ArtistSimilar.parse(JSONObject("""{"source":"Deezer","artists":[
            {"name":"Artist B","in_library":true,"photo_key":"u-eA"},
            {"name":"Somebody Else","in_library":false,"photo_key":null},
            {"name":"","in_library":false}]}"""))
        assertEquals("Deezer", s.source)
        assertEquals(listOf("Artist B", "Somebody Else"), s.artists.map { it.name })
        assertTrue(s.artists[0].inLibrary)
        assertFalse(s.artists[1].inLibrary)
        assertEquals("u-eA", s.artists[0].photoKey)
        assertNull(s.artists[1].photoKey)
        val none = ArtistSimilar.parse(JSONObject("""{"source":null,"artists":[]}"""))
        assertNull(none.source)
        assertTrue(none.artists.isEmpty())
    }
}
