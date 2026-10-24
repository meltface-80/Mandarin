package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Item 158: "home" is the home address answering as this phone's own server, not any server there. */
class ServerIdTest {
    @Test fun `the id read from a ping`() {
        assertEquals("ab12", ServerId.of("""{"ok":true,"version":"1.1.7","id":"ab12"}"""))
        assertNull(ServerId.of("""{"ok":true,"version":"1.1.5"}"""))
        assertNull(ServerId.of("not json"))
        assertNull(ServerId.of(null))
    }

    @Test fun `another server at the home address isn't ours`() {
        assertFalse(ServerId.ours(kept = "ab12", answered = "ffff"))
        assertTrue(ServerId.ours(kept = "ab12", answered = "ab12"))
        assertTrue(ServerId.ours(kept = null, answered = "ffff"))   // nothing kept yet: as before
        assertTrue(ServerId.ours(kept = "ab12", answered = null))   // a server from before ids
    }
}
