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

    // A room's answer with its modes, format, speakers and credits, as /api/zone-state gives them.
    private fun full(loop: String, shuffle: Boolean, volume: String) = ZoneState.parse(JSONObject(
        """{"revision": 3, "zone": {"zone_id": "z1", "display_name": "Kitchen", "state": "playing",
            "settings": {"shuffle": $shuffle, "loop": "$loop"},
            "now_playing": {"line1": "Song 1", "line2": "Artist A / Artist B", "line3": "Album One", "length": 200, "seek_position": 5,
              "artists": [{"name": "Artist A", "linkable": true}, {"name": "Artist B", "linkable": false}],
              "album_offset": 42, "track_id": 7, "format": {"kind": "opus", "text": "256kbps"}},
            "outputs": [{"output_id": "o1", "display_name": "Kitchen", "is_muted": false, "volume": $volume},
                        {"output_id": "o2", "display_name": "Sub", "is_muted": true, "volume": null}]}}"""
    ))

    @Test fun `shuffle, repeat and the format, as the page's buttons and badge have them`() {
        val v = NowPlayingView.of(full("loop", true, "null"), 0)!!
        assertEquals(1, v.shuffleState)
        assertEquals("Repeat queue, then the track", listOf(1, "loop_one"), listOf(v.loopState, v.loopNext))
        assertEquals("Opus 256kbps", v.formatText)
        assertEquals("the mini player's kicker: no kbps", "Opus 256", v.formatWord)
        assertEquals("Lossless", v.copy(format = Format("lossless", "Lossless")).formatWord)
        assertEquals(null, v.copy(format = Format("lossless", "")).formatWord)
        assertEquals("a step on the scale, held within it", listOf(55.0, 100.0), listOf(VolumeScale(0.0, 100.0, 5.0, 50.0, null).stepped(1), VolumeScale(0.0, 100.0, 5.0, 98.0, null).stepped(1)))
        assertEquals(null, VolumeScale(0.0, 100.0, 5.0, null, null).stepped(-1))
        val off = NowPlayingView.of(full("disabled", false, "null"), 0)!!
        assertEquals(listOf(0, 0, "loop"), listOf(off.shuffleState, off.loopState, off.loopNext))
        assertEquals("off after the track", "disabled", NowPlayingView.of(full("loop_one", false, "null"), 0)!!.loopNext)
        assertEquals("anything else is off", 0, NowPlayingView.of(full("radio", false, "null"), 0)!!.loopState)
        val np = full("loop", true, "null").zone!!.nowPlaying!!
        assertEquals(listOf(Credit("Artist A", true), Credit("Artist B", false)), np.artists)
        assertEquals("the screen's credits", np.artists, v.artists)
        assertEquals("the track playing, for the album page's disc", 7L, v.trackId)
        assertEquals("42", np.albumId)
    }

    @Test fun `the room's volume, its scale and a step within it, or fixed`() {
        val v = NowPlayingView.of(full("disabled", false, """{"type": "number", "min": 0, "max": 100, "step": 2, "value": 89, "soft_limit": 90}"""), 0)!!
        assertEquals(VolumeScale(0.0, 90.0, 2.0, 89.0, "number"), v.volume)
        assertEquals("held to the soft limit", 90.0, v.volumeStep(1)!!, 0.0)
        assertEquals(87.0, v.volumeStep(-1)!!, 0.0)
        assertTrue("a speaker muted: the room shows muted", v.muted)
        assertNull("no speaker with a volume: fixed", NowPlayingView.of(full("disabled", false, "null"), 0)!!.volume)
        assertTrue(NowPlayingView.of(full("disabled", false, """{"type": "incremental"}"""), 0)!!.volume!!.incremental)
    }

    @Test fun `the Play on list, each room, its speakers when it has more than one`() {
        val rooms = Room.list(JSONObject("""{"zones": [{"zone_id": "z1", "display_name": "Kitchen", "outputs": [{"display_name": "Kitchen"}]},
            {"zone_id": "z2", "display_name": "Lounge + Study", "outputs": [{"display_name": "Lounge"}, {"display_name": "Study"}]}, {"display_name": "no id"}]}"""))
        assertEquals(listOf(Room("z1", "Kitchen", listOf("Kitchen")), Room("z2", "Lounge + Study", listOf("Lounge", "Study"))), rooms)
    }
}
