package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Scrobbling's block in Settings → API Keys: what it says, and its button, from /api/lastfm/scrobbling. */
class ScrobblingTest {
    private fun of(json: String) = Scrobbling.parse(JSONObject(json))

    @Test fun `connected: who, and what waits or went wrong`() {
        val s = of("""{"key_set":true,"secret_set":true,"connected":true,"name":"meltface","pending":false,"queued":0,"error":null}""")
        assertTrue(s.connected)
        assertEquals(1, s.button)
        assertEquals("Scrobbling as meltface: every room, Bridge and this phone.", s.line)
        assertEquals("Scrobbling as meltface: every room, Bridge and this phone. 3 waiting to send. Last.fm did not answer.",
            s.copy(queued = 3, error = "Last.fm did not answer").line)
    }

    @Test fun `not connected: what to do next`() {
        val none = of("""{"key_set":false,"secret_set":false,"connected":false,"name":null,"pending":false,"queued":0,"error":null}""")
        assertFalse(none.ready)
        assertEquals(0, none.button)
        assertNull(none.name)
        assertEquals("Save the Last.fm key and shared secret above, then connect.", none.line)
        assertEquals("Not connected.", none.copy(keySet = true, secretSet = true).line)
        assertEquals("Allow Mandarin on Last.fm, then come back here.", none.copy(keySet = true, secretSet = true, pending = true).line)
        assertEquals("Last.fm no longer accepts Mandarin's sign-in: connect again.",
            none.copy(keySet = true, secretSet = true, error = "Last.fm no longer accepts Mandarin's sign-in: connect again").line)
    }
}
