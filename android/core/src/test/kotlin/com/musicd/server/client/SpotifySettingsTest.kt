package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings → Services → Spotify as the page says it (item 142). */
class SpotifySettingsTest {
    private val date = { d: String -> "D$d" }

    @Test fun `no key, no PulseAudio, no Soloist yet, and downloading`() {
        assertEquals("No Soloist API key yet: make one at developer.spotify.com/dashboard/soloist.",
            SpotifySettings.parse(JSONObject("""{"has_key":false,"pulseaudio":true}"""), date).status)
        assertEquals("This server has no PulseAudio: Soloist can't play here.",
            SpotifySettings.parse(JSONObject("""{"has_key":true,"pulseaudio":false}"""), date).status)
        val none = SpotifySettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"soloist":{"version":"","expires":null,"fetching":false,"error":""}}"""), date)
        assertEquals("Soloist isn't downloaded yet.", none.status)
        assertEquals("Download Soloist", none.download)
        assertEquals("", none.build)
        val fetching = SpotifySettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"soloist":{"version":"","expires":null,"fetching":true,"error":""}}"""), date)
        assertEquals("Downloading Soloist from Spotify…", fetching.status)
        assertEquals("Downloading Soloist from Spotify…", fetching.build)
        assertTrue(fetching.fetching)
    }

    @Test fun `playing, with what the sound has proven, and the build's line`() {
        val a = SpotifySettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"room":"RINCON_1","device_name":"Lounge","status":"playing","playback":"playing",
            "quality":"Spotify · Lossless 24-bit/44.1 kHz","soloist":{"version":"1.2.3 (20261001)","expires":"2026-12-30","fetching":false,"error":""}}"""), date)
        assertEquals("playing · Spotify · Lossless 24-bit/44.1 kHz", a.status)
        assertEquals("Soloist 1.2.3 · runs out D2026-12-30", a.build)
        assertEquals("Update Soloist", a.download)
        assertEquals("RINCON_1", a.room)
        assertEquals("Lounge", a.deviceName)
        assertFalse(a.fetching)
        val paused = SpotifySettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"status":"paused","playback":"paused","quality":"Spotify",
            "soloist":{"version":"1.2.3","expires":null,"error":"timed out"}}"""), date)
        assertEquals("paused", paused.status)
        assertEquals("Couldn't download Soloist: timed out", paused.build)
    }

    @Test fun `the rooms, None first, no phone, and one not here now`() {
        val zones = JSONObject("""{"zones":[{"zone_id":"a","display_name":"Lounge"},{"zone_id":"p","display_name":"Phone","is_phone":true},{"zone_id":"b","display_name":"Study"}]}""")
        assertEquals(listOf(Choice("", "None"), Choice("a", "Lounge"), Choice("b", "Study")), SpotifySettings.rooms(zones, "a"))
        assertEquals(listOf(Choice("", "None"), Choice("a", "Lounge"), Choice("b", "Study"), Choice("gone", "A room not here now")), SpotifySettings.rooms(zones, "gone"))
        assertEquals(listOf(Choice("", "None")), SpotifySettings.rooms(JSONObject("{}"), ""))
    }
}
