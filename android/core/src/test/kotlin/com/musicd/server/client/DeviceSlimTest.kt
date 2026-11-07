package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A Squeezelite player's page (item 313), as the page's app/audio-devices.js and app/device-gapless.js have it (test/device-slim-page.test.js). */
class DeviceSlimTest {
    private fun page(kind: String, extra: String = "") =
        DevicePage(JSONObject("""{"kind":"$kind","enabled":false,"rates":[],"bits":[],"dsd":[],"containers":["flac","dsd"],"found_by":"It connected to Mandarin"$extra,"output":{"mode":"original"}}"""))

    @Test fun `its Output shown, its Standard SlimProto, off as a Squeezelite player`() {
        val slim = page("slim")
        assertTrue("Output, as a renderer's", slim.showOutput)
        assertEquals("Not offered as a zone. A Squeezelite player stays off until you turn it on.", slim.onNote)
        assertTrue(slim.about { "" }.contains("Standard" to "SlimProto (Squeezebox)"))
        assertTrue(slim.about { "" }.contains("Found by" to "It connected to Mandarin"))
    }

    @Test fun `Gapless is its note alone, and DSD goes as DSF to its own -D`() {
        val slim = page("slim")
        assertTrue(slim.slimGapless)
        assertTrue(slim.slimGaplessNote.startsWith("A Squeezelite player plays one track into the next from its own buffer"))
        assertTrue(slim.capNotes.any { it.startsWith("DSD files go to it as DSF") && it.contains("-D option") })
        assertFalse("a renderer keeps its switch", page("upnp").slimGapless)
    }

    @Test fun `a Mandarin Bridge played continuous PCM has no Gapless group`() {
        val bridge = page("slim", ""","continuous_pcm":true""")
        assertFalse(bridge.slimGapless)
    }
}
