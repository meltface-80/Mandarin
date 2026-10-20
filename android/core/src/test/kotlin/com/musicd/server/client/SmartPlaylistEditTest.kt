package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A Dynamic Playlist made or edited as the page makes it (item 95). */
class SmartPlaylistEditTest {
    @Test fun `New's choices, and a new playlist starting from the Library's view`() {
        assertEquals(listOf("Albums", "Tracks"), SmartEdit.MODES.map { it.label })
        val t = SmartEdit.newTarget(LibraryView.parse("sort=year&dir=desc&genre=Jazz&prefix=b"), "tracks")
        assertEquals(null, t.id)
        assertEquals(100, t.limit)
        assertEquals("album", t.order)
        assertEquals("", t.view.prefix)
        assertEquals(listOf("Jazz"), t.view.facets["genre"])
        assertTrue(t.orderNote.startsWith("Album order plays each record straight through"))
        assertTrue(SmartEdit.orderNote("albums").startsWith("Album order queues the albums"))
        assertEquals("My Dynamic Playlist", SmartEdit.suggested(t))
    }

    @Test fun `a saved playlist edited from its own view, decades as words and facets it doesn't name off`() {
        val p = SmartPlaylist.list(JSONObject("""{"playlists":[{"id":"7","name":"Late","mode":"albums","order":"random","limit":25,
            "view":{"sort":"added","dir":"asc","seed":42,"played":"never","decade":[1990,"!1980"],"genre":[]}}]}""")).single()
        val t = SmartEdit.editTarget(p)
        assertEquals("7", t.id)
        assertEquals(25, t.limit)
        assertEquals("random", t.order)
        assertEquals("Late", SmartEdit.suggested(t))
        assertEquals(LibraryView(sort = "added", dir = "asc", seed = 42, played = "never", facets = mapOf("decade" to listOf("1990", "!1980"))), t.view)
        assertEquals(100, SmartPlaylist.list(JSONObject("""{"playlists":[{"id":"1"}]}""")).single().limit)
    }

    @Test fun `what is sent, and what is said once saved`() {
        val v = LibraryView(sort = "artist", dir = "desc", seed = 3, played = "6", facets = mapOf("genre" to listOf("Rock")))
        val j = SmartEdit.viewJson(v)
        assertEquals("artist", j.getString("sort"))
        assertEquals("Rock", j.getJSONArray("genre").getString(0))
        assertEquals(0, j.getJSONArray("label").length())
        assertEquals(v, SmartEdit.viewOf(j))
        val fromLibrary = SmartEdit.body(null, "  Mine ", v)
        assertEquals("Mine", fromLibrary.getString("name"))
        assertTrue(fromLibrary.isNull("id") && fromLibrary.isNull("limit") && fromLibrary.isNull("mode") && fromLibrary.isNull("order"))
        val edited = SmartEdit.body(SmartTarget("9", "Old", v, 200, "tracks", "random"), "New", v)
        assertEquals("9", edited.getString("id"))
        assertEquals(200, edited.getInt("limit"))
        assertEquals("tracks", edited.getString("mode"))
        assertEquals("Give it a name", SmartEdit.nameError("   "))
        assertNull(SmartEdit.nameError("x"))
        assertEquals("Saved \"Mine\"", SmartEdit.saved(" Mine ", JSONObject("""{"playlist":{"limit":100,"album_matched":40}}""")))
        assertEquals("Saved \"Mine\" — it plays 100 of the 240 albums that match. Change that with Edit.",
            SmartEdit.saved("Mine", JSONObject("""{"playlist":{"limit":100,"album_matched":240}}""")))
    }
}
