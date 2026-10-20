package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Your playlists read as the server answers (item 65; the shape test/playlists tests hold the server to), and what playing one says. */
class PlaylistTest {
    @Test fun `a playlist with its tracks, each line as the page writes it`() {
        val p = UserPlaylist.parse(JSONObject("""{"id":"p1","name":"Road trip","track_total":2,"tracks":[
            {"album_offset":3,"album_title":"Album One","album_subtitle":"Artist A","track_index":0,"title":"Song 1","subtitle":"Artist A","image_key":"k1"},
            {"album_offset":3,"album_title":"","album_subtitle":"Artist A","track_index":1,"title":"Song 2","subtitle":"","image_key":null}]}"""))
        assertEquals("Road trip", p.name)
        assertEquals("2 tracks", p.count)
        assertEquals(listOf("Artist A · Album One", ""), p.tracks.map { it.line })
        assertEquals(listOf(0, 1), p.tracks.map { it.trackIndex })
        assertNull(p.tracks[1].imageKey)
        assertEquals("1 track", UserPlaylist("x", "One", p.tracks.take(1)).count)
        assertEquals("a playlist without a name", "Playlist", UserPlaylist.parse(JSONObject("""{"id":"x","name":"","tracks":[]}""")).name)
    }

    @Test fun `what playing or queuing a playlist says`() {
        assertEquals("Playing 2 tracks", UserPlaylist.report("play_now", 2, 0, ""))
        assertEquals("Queued 1 track", UserPlaylist.report("queue", 1, 0, ""))
        assertEquals("Playing 1 track (1 couldn't be found: gone)", UserPlaylist.report("play_now", 1, 1, "gone"))
        assertEquals("refused", UserPlaylist.report("play_now", 0, 2, "refused"))
        assertEquals("Sonos refused those tracks", UserPlaylist.report("queue", 0, 2, ""))
    }

    @Test fun `the routes and the client's paths`() {
        assertEquals("playlists?zone=z", ShellRoute.playlists("z"))
        assertEquals("playlist/a%20b?zone=z", ShellRoute.playlist("a b", "z"))
        val asked = ArrayList<String>()
        val c = LibraryClient { asked += it; JSONObject("""{"playlists":[],"id":"a b","name":"N","tracks":[]}""") }
        c.userPlaylists(); c.userPlaylist("a b")
        assertEquals(listOf("/api/user-playlists", "/api/user-playlist?id=a%20b"), asked)
    }
}
