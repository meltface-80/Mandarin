package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Add to playlist as the page words and sends it (item 93). */
class PlaylistAddTest {
    private fun summary(offset: Long, title: String) = AlbumSummary(offset, title, "Artist A", "k$offset", null, null, null, null)

    @Test fun `tracks picked on an album's page, in the album's order, to a playlist or a new one`() {
        val a = Album(summary(7, "Album One"), emptyList(), listOf(Track(1, "Song 1", "Artist A · 3:00", 180.0, null), Track(2, "Song 2", "Artist A · 4:00", 240.0, null),
            Track(3, "Song 3", "Artist A · 5:00", 300.0, null)), emptyList(), emptyList(), emptyList(), false)
        val add = PlaylistAdd.tracks(a, listOf(2, 0, 9))
        assertEquals("Add 2 tracks to…", add.title)
        assertEquals("/api/user-playlists/add", add.path)
        assertNull(add.reading)
        val body = add.body("p1", null)
        assertEquals("p1", body.getString("id"))
        val t = body.getJSONArray("tracks")
        assertEquals(listOf(0, 2), (0 until t.length()).map { t.getJSONObject(it).getInt("track_index") })
        assertEquals("Song 3", t.getJSONObject(1).getString("title"))
        assertEquals("Album One", t.getJSONObject(1).getString("album_title"))
        assertEquals("Artist A", t.getJSONObject(1).getString("subtitle"))
        assertEquals("k7", t.getJSONObject(0).getString("image_key"))
        assertEquals("Mix", add.body(null, "Mix").getString("name"))
    }

    @Test fun `whole albums, read by the server`() {
        val add = PlaylistAdd.albums(listOf(summary(3, "Hi Res")))
        assertEquals("Add 1 album to…", add.title)
        assertEquals("/api/user-playlists/add-albums", add.path)
        assertEquals("Reading 1 album…", add.reading)
        assertEquals(3L, add.body("p", null).getJSONArray("albums").getJSONObject(0).getLong("offset"))
        assertEquals("Add 2 albums to…", PlaylistAdd.albums(listOf(summary(1, "a"), summary(2, "b"))).title)
    }

    @Test fun `your playlists listed, and what is said once added`() {
        val list = AddToPlaylist.choices(JSONObject("""{"playlists":[{"id":"a","name":"Road trip","track_total":1},{"id":"b","name":"Late","track_total":12}]}"""))
        assertEquals(listOf("Road trip · 1 track", "Late · 12 tracks"), list.map { it.label })
        assertEquals("Added 1 track to \"Road trip\"" to false, AddToPlaylist.said(JSONObject("""{"added":1,"name":"Road trip"}""")))
        assertEquals("Added 20 tracks from 2 albums to \"Mix\" — the playlist is now full; 3 couldn't be stored (full); couldn't read Hi Res" to true,
            AddToPlaylist.said(JSONObject("""{"added":20,"albums_read":2,"name":"Mix","full":true,"skipped":3,"reason":"full","albums_failed":["Hi Res"]}""")))
    }
}
