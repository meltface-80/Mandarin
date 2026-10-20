package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The server's gate shutting on this phone signs the app out; a wrong password asked again does not (item 111). */
class GateWatchTest {
    private fun asked(status: Int, error: String): Int {
        var shut = 0
        val t = GateWatch(LocalTransport { _, _, _, _ -> Answer.error(status, error) }) { shut++ }
        val e = runCatching { t.json("GET", "/api/zones", null, 1000) }.exceptionOrNull()
        assertTrue(e is ServerClient.ServerException)
        return shut
    }

    @Test fun `the gate shut is told, anything else only thrown`() {
        assertEquals(1, asked(401, "Sign in to Mandarin"))
        assertEquals(1, asked(401, "Create the Mandarin account first"))
        assertEquals(0, asked(401, "Wrong username or password"))
        assertEquals(0, asked(500, "Sign in to Mandarin"))
    }
}
