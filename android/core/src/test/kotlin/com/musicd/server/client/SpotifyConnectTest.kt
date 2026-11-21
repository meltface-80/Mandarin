package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyConnectTest {
    @Test fun `no key, no PulseAudio, Soloist's own words, and what plays, as the page says them`() {
        val none = SpotifyConnectSettings.parse(JSONObject("""{"has_key":false,"soloist":{}}"""), { it })
        assertEquals("Add your Soloist API key to show Mandarin in the Spotify app.", none.status)
        assertEquals("Download Soloist", none.download)
        assertEquals("", none.build)
        assertFalse(none.again)
        assertEquals("Needs PulseAudio for Soloist's sound: update Mandarin OS (0.1.13 or later).",
            SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"pulseaudio":false}"""), { it }).status)
        val waiting = SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"status":"signed in · choose Lounge in the Spotify app's devices",
            "playback":"idle","soloist":{"version":"soloist 1.3.9 (20261111)","expires":"2027-02-09","fetching":false,"error":""}}"""), { "9 Feb 2027" })
        assertEquals("Signed in · choose Lounge in the Spotify app's devices", waiting.status)
        assertNull(waiting.sound)
        assertEquals("Update Soloist", waiting.download)
        assertEquals("soloist 1.3.9 (20261111) · runs out 9 Feb 2027", waiting.build)
        val playing = SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"active":true,"playback":"playing","status":"playing",
            "track":{"title":"So What","artists":"Miles Davis","album":"Kind of Blue"},"quality":"Spotify · Lossless 24-bit/44.1 kHz",
            "sent":"upsampled ×4 to 176.4 kHz, 24-bit","room":"r1","rooms":[{"id":"r1","name":"Lounge","sound":"upsampled ×4 to 176.4 kHz, 24-bit"},{"id":"r2","name":"Study","sound":""}],
            "soloist":{"fetching":false}}"""), { it })
        assertEquals("Playing So What — Miles Davis", playing.status)
        assertEquals("Spotify · Lossless 24-bit/44.1 kHz · sent upsampled ×4 to 176.4 kHz, 24-bit", playing.sound)
        assertTrue(playing.again)
        assertEquals(listOf("Lounge · upsampled ×4 to 176.4 kHz, 24-bit", "Study"), playing.rooms.map { it.words })
        assertEquals("Paused: So What — Miles Davis",
            SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"pulseaudio":true,"active":true,"playback":"paused","track":{"title":"So What","artists":"Miles Davis"}}"""), { it }).status)
        val busy = SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"soloist":{"fetching":true,"error":"","version":""}}"""), { it })
        assertEquals("Downloading…", busy.download)
        assertTrue(busy.again)
        assertEquals("Couldn't download Soloist: 404", SpotifyConnectSettings.parse(JSONObject("""{"has_key":true,"soloist":{"error":"404"}}"""), { it }).build)
    }
}
