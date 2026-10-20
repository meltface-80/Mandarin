package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Offline dialog's words, as the page's (item 105; test/offline-words.test.js holds them to server-notice.js). */
class OfflineTest {
    @Test fun `offline by choice, with the switch to turn it off`() {
        assertEquals("Offline mode is on", OfflineNote.title(OfflineKind.MODE))
        assertEquals(2, OfflineNote.lines(OfflineKind.MODE).size)
        assertTrue(OfflineNote.lines(OfflineKind.MODE)[1].startsWith("Switch it off"))
        assertTrue(OfflineNote.canSwitch(OfflineKind.MODE))
        assertFalse(OfflineNote.canRetry(OfflineKind.MODE))
    }

    @Test fun `the server away, nothing to switch`() {
        assertEquals("Mandarin can’t be reached", OfflineNote.title(OfflineKind.APP))
        assertEquals(3, OfflineNote.lines(OfflineKind.APP).size)
        assertTrue(OfflineNote.lines(OfflineKind.APP)[0].startsWith("This phone can’t reach"))
        assertFalse(OfflineNote.canSwitch(OfflineKind.APP))
        assertTrue(OfflineNote.canRetry(OfflineKind.APP))
    }
}
