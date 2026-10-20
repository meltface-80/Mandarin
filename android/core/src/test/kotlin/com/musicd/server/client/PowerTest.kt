package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Restart and Shut down as the page's power.js says them (item 96). */
class PowerTest {
    @Test fun `the questions`() {
        assertEquals("Restart Mandarin? Music playing from Mandarin stops, and it's back in a few seconds.", Power.ask("power-restart", null))
        assertEquals("Shut down Mandarin? Music playing from Mandarin stops. To start it again, start it the way it was started.",
            Power.ask("power-shutdown", JSONObject("""{"shutdown":true,"start_again":"manual"}""")))
        assertEquals("Shut down Mandarin? Music playing from Mandarin stops. ", Power.ask("power-shutdown", JSONObject("""{"start_again":"docker"}""")))
        assertEquals("/api/system/shutdown", Power.path("power-shutdown"))
    }

    @Test fun `the screen while the server is away`() {
        assertEquals(Power.Cover("Restarting Mandarin…", "This page reloads when it's back.", 1000), Power.cover("power-restart", JSONObject("{}"), null))
        assertEquals(Power.Cover("Mandarin is shut down", "To start it again, start it the way it was started.", 5000),
            Power.cover("power-shutdown", JSONObject("""{"start_again":"manual"}"""), null))
        // The answer saying nothing of it: what the server said before.
        assertEquals("To start it again, start it the way it was started.",
            Power.cover("power-shutdown", JSONObject("{}"), JSONObject("""{"start_again":"manual"}""")).text)
    }

    @Test fun `back only once it has been away`() {
        val w = Power.BackWatch()
        assertFalse("still on its way down", w.seen(true))
        assertFalse(w.seen(false))
        assertFalse(w.seen(false))
        assertTrue(w.seen(true))
    }
}
