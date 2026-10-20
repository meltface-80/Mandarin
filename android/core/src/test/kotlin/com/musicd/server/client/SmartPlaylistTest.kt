package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Dynamic Playlists read as the server answers (item 66; server/Mandarin.Server/SettingsRoutes.cs), and the lines the page writes about them. */
class SmartPlaylistTest {
    @Test fun `the list, and a saved view in a line as the page writes it`() {
        val l = SmartPlaylist.list(JSONObject("""{"playlists":[{"id":"s1","name":"Old rock","view":{"sort":"year","dir":"desc","genre":["Rock","!Jazz"],"decade":[1990],"played":"never"},
            "limit":100,"mode":"tracks","order":"random","count":3,"matched":3,"art_keys":["a","b",""]},{"id":"s2","name":"","view":{},"mode":"","order":""}]}"""))
        val p = l[0]
        assertTrue(p.tracks)
        assertEquals(listOf("a", "b"), p.artKeys)
        assertEquals("Release date ↓ · Rock, not Jazz · 1990s · never played", SmartPlaylist.describe(p.view))
        assertEquals("Tracks · random · Release date ↓ · Rock, not Jazz · 1990s · never played", p.detail)
        assertEquals("Dynamic Playlist", l[1].name)
        assertFalse(l[1].tracks)
        assertEquals("an empty view says nothing of it", "Albums · album order", l[1].detail)
        assertEquals("Random ↑ · not in 12 months", SmartPlaylist.describe(JSONObject("""{"sort":"random","played":"12"}""")))
        assertEquals("not played in 3 months", SmartPlaylist.describe(JSONObject("""{"played":"3"}""")))
    }

    @Test fun `a tracks playlist's pages and its line`() {
        val t = SmartTracks.parse(JSONObject("""{"tracks":[{"album_offset":3,"album_title":"Album One","album_artist":"Artist A","image_key":"k","track_index":0,"title":"Song 1","subtitle":"Artist A","track_no":1}],
            "album_offset":0,"albums_expanded":1,"album_total":3,"done":false}"""))
        assertEquals("Artist A · Album One", t.tracks[0].line)
        assertEquals(1, t.albumsExpanded)
        assertFalse(t.done)
        assertEquals("1 tracks so far — 2 album(s) left", SmartTracks.status(1, 1, 3, false))
        assertEquals("7 tracks from 3 albums", SmartTracks.status(7, 3, 3, true))
        assertEquals("1 track from 1 album", SmartTracks.status(1, 1, 1, true))
        assertEquals(SmartTracks.NOTHING, SmartTracks.status(0, 0, 0, true))
    }

    @Test fun `an albums playlist's albums, and what playing them says`() {
        val a = SmartAlbums.parse(JSONObject("""{"albums":[{"offset":3,"title":"Album One","subtitle":"Artist A","image_key":"k"}],"total":1,"matched":5}"""))
        assertEquals("Album One", a.albums[0].title)
        assertEquals("1 of 5 albums that match", a.status)
        assertEquals("1 album", SmartAlbums(a.albums, 1).status)
        assertEquals(SmartTracks.NOTHING, SmartAlbums(emptyList(), 0).status)
        assertEquals("Playing 12 albums", SmartPlaylist.outcome("Playing", 12, 0, 12, 12))
        assertEquals("Queued 400 of 900 albums (Sonos refused 2) — that's the limit per go", SmartPlaylist.outcome("Queued", 400, 2, 400, 900))
        assertEquals("Playing 1 album", SmartPlaylist.outcome("Playing", 1, 0, 1, 1))
    }

    @Test fun `the routes and the client's paths`() {
        assertEquals("smart-playlists?zone=z", ShellRoute.smartPlaylists("z"))
        assertEquals("smart-playlist/s%201?zone=z", ShellRoute.smartPlaylist("s 1", "z"))
        val asked = ArrayList<String>()
        val c = LibraryClient { asked += it; JSONObject("""{"playlists":[],"tracks":[],"albums":[]}""") }
        c.smartPlaylists(); c.smartTracks("s 1", 8, "z"); c.smartTracks("s", 0, ""); c.smartAlbums("s"); c.smartAlbums("s", 400)
        assertEquals(listOf("/api/smart-playlists", "/api/smart-playlist?id=s%201&offset=8&zone=z", "/api/smart-playlist?id=s&offset=0",
            "/api/smart-playlist/albums?id=s", "/api/smart-playlist/albums?id=s&max=400"), asked)
    }
}
