package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LastfmTest {
    @Test fun `similar artists, the library's own and Last fm's, the page listing them`() {
        val s = SimilarArtists.parse(JSONObject("""{"enabled": true, "artist": "Artist A", "url": "https://last.fm/a",
            "artists": [{"name": "Artist B", "url": "https://last.fm/b", "image_key": "k1", "in_library": true}, {"name": "Artist C", "url": "https://last.fm/c", "image_key": null, "in_library": false}]}"""))
        assertTrue(s.enabled); assertNull(s.error); assertEquals("https://last.fm/a", s.url)
        assertEquals(listOf(SimilarArtist("Artist B", "https://last.fm/b", "k1", true), SimilarArtist("Artist C", "https://last.fm/c", null, false)), s.artists)
        assertNull(s.keyNote)
        val off = SimilarArtists.parse(JSONObject("""{"enabled": false}"""))
        assertFalse(off.enabled); assertEquals(emptyList<SimilarArtist>(), off.artists)
        val bad = SimilarArtists.parse(JSONObject("""{"enabled": true, "error": "Invalid API key"}"""))
        assertEquals("the key, said aloud", "Invalid API key — Settings → Setup → API Keys.", bad.keyNote)
        assertNull("anything else, not", SimilarArtists.parse(JSONObject("""{"enabled": true, "error": "Last.fm is slow"}""")).keyNote)
    }

    @Test fun `similar albums, the library's own where it has them`() {
        val s = SimilarAlbums.parse(JSONObject("""{"enabled": true, "albums": [
            {"title": "Album Two", "artist": "Artist B", "url": "https://last.fm/x", "image_key": "k", "album": {"offset": 7, "title": "Album Two", "subtitle": "Artist B"}},
            {"title": "Far Away", "artist": "Artist Z", "url": "https://last.fm/y", "image_key": null, "album": null}]}"""))
        assertEquals(2, s.albums.size)
        assertEquals(7L, s.albums[0].album!!.offset)
        assertNull(s.albums[1].album); assertEquals("https://last.fm/y", s.albums[1].url)
    }
}
