package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The default service (item 522): Settings → Services' list, and an artist's albums on it. */
class DefaultServiceTest {
    @Test fun `the list is None, then the server's choices, one not signed in saying so`() {
        val d = DefaultService.parse(JSONObject("""{"service":"tidal","choices":[
            {"id":"qobuz","name":"Qobuz","connected":true},
            {"id":"tidal","name":"Tidal","connected":false},
            {"id":"","name":"Nameless"}]}"""))
        assertEquals("tidal", d.service)
        assertEquals(listOf("", "qobuz", "tidal"), d.choices.map { it.value })
        assertEquals(listOf("None", "Qobuz", "Tidal (not signed in)"), d.choices.map { it.words })
        val none = DefaultService.parse(JSONObject("""{"service":""}"""))
        assertEquals("", none.service)
        assertEquals(listOf(Choice("", "None")), none.choices)
    }

    @Test fun `an artist's albums on the service, under its name`() {
        val d = ArtistDiscography.parse(JSONObject("""{"service":"qobuz","name":"Qobuz","artist":{"id":"12","name":"Artist A"},"albums":[
            {"id":"a1","title":"Album One","version":"Deluxe","artist":"Artist A","image":"https://img/a1.jpg","year":"2001"},
            {"id":"a2","title":"Album Two","version":"","artist":"Artist A","image":null}]}"""))
        assertEquals("qobuz", d.service)
        assertEquals("More on Qobuz", d.heading)
        assertEquals(listOf("a1", "a2"), d.albums.map { it.id })
        assertEquals("qobuz", d.albums[0].service)
        assertEquals("Deluxe", d.albums[0].version)
        assertEquals(null, d.albums[1].image)
    }

    @Test fun `nothing for no default service, or the service not answering`() {
        assertTrue(ArtistDiscography.parse(JSONObject("""{"service":"","albums":[]}""")).albums.isEmpty())
        assertTrue(ArtistDiscography.parse(JSONObject("""{"service":"tidal","name":"Tidal","error":"not connected","albums":[{"id":"x","title":"X"}]}""")).albums.isEmpty())
    }

    @Test fun `the address names the act where acts share the name`() {
        assertEquals("/api/artist-discography?artist=Artist+A", ArtistDiscography.path("Artist A", null))
        assertEquals("/api/artist-discography?artist=AC%2FDC&artist_id=7", ArtistDiscography.path("AC/DC", 7))
    }
}
