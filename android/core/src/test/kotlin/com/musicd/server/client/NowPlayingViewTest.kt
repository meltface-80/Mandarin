package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NowPlayingViewTest {
    // A room's answer as /api/zone-state gives it.
    private fun state(state: String, seek: Int?, length: Int?, nowPlaying: Boolean = true) = ZoneState.parse(JSONObject(
        """{"revision": 7, "zone": {"zone_id": "z1", "display_name": "Kitchen", "state": "$state",
            "is_next_allowed": true, "is_previous_allowed": false,
            "now_playing": ${if (!nowPlaying) "null" else """{"line1": "Song 1", "line2": "Artist A", "line3": "Album One", "image_key": "al-3-x",
              "length": ${length ?: "null"}, "seek_position": ${seek ?: "null"}}"""},
            "outputs": []}}"""
    ))

    @Test fun `a room playing, its track, cover and transport`() {
        val v = NowPlayingView.of(state("playing", 10, 200), answeredAtMs = 1_000)!!
        assertEquals("Kitchen", v.zoneName)
        assertEquals(listOf("Song 1", "Artist A", "Album One"), listOf(v.title, v.artist, v.album))
        assertEquals("al-3-x", v.imageKey)
        assertTrue(v.playing)
        assertTrue(v.canNext)
        assertFalse(v.canPrevious)
    }

    @Test fun `while it plays the track moves on by the clock, never past its end`() {
        val v = NowPlayingView.of(state("playing", 10, 200), answeredAtMs = 1_000)!!
        assertEquals(10.0, v.position(1_000), 0.0)
        assertEquals(12.5, v.position(3_500), 0.0)
        assertEquals("a clock behind the answer: where it was", 10.0, v.position(500), 0.0)
        assertEquals(200.0, v.position(1_000_000), 0.0)
        assertEquals(0.0625f, v.fraction(3_500), 0.0001f)
    }

    @Test fun `paused it stays where it is`() {
        val v = NowPlayingView.of(state("paused", 42, 200), answeredAtMs = 1_000)!!
        assertFalse(v.playing)
        assertEquals(42.0, v.position(60_000), 0.0)
    }

    @Test fun `a track of no known length, and a room playing nothing`() {
        val v = NowPlayingView.of(state("playing", null, null), answeredAtMs = 0)!!
        assertNull(v.lengthSeconds)
        assertEquals(0f, v.fraction(5_000), 0f)
        assertEquals(5.0, v.position(5_000), 0.0)
        assertNull(NowPlayingView.of(state("stopped", null, null, nowPlaying = false), 0))
    }

    @Test fun `times as the page writes them`() {
        assertEquals("0:03", NowPlayingView.clock(3.9))
        assertEquals("4:05", NowPlayingView.clock(245.0))
        assertEquals("1:02:03", NowPlayingView.clock(3723.0))
        assertEquals("0:00", NowPlayingView.clock(-2.0))
    }

    @Test fun `Now playing's route carries its room there and back`() {
        for (z in listOf("RINCON_000E58A0B1C201400", "PHONE_offline", "renderer:uuid:4d696e69/x y")) {
            val r = ShellRoute.nowPlaying(z)
            assertTrue(r, r.startsWith("nowplaying/") && r.indexOf('/', "nowplaying/".length) < 0)
            assertEquals(z, ShellRoute.zoneOf(r.removePrefix("nowplaying/")))
            assertFalse("the shell's, not the page's", ShellRoute.isWeb(r))
            assertFalse("no \"+\", which Navigation would leave as it is", r.contains('+'))
        }
    }
}
