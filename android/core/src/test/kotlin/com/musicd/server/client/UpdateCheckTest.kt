package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Settings → Updates, a row each for the server and this app (item 223): each its own Check for update, Update available
 * once found, and what each brings under both, once for a version both bring. The server ahead of the app (item 178): a
 * release's app reaches main's dist/latest.json a few minutes after its server, so it is on its way; a test build's
 * (dev's, 1.1.9-tN) never does, its app being on the test-android page, which is said rather than promised, in the
 * same words as the page's check-update.js.
 */
class UpdateCheckTest {
    @Test fun `an update found, its version and its notes, and none when none is on offer`() {
        assertEquals(UpdateFound("1.1.14", "• Fixed - track times"), UpdateCheck.found(JSONObject("""{"available":true,"latest":"1.1.14","current":"1.1.13","notes":"• Fixed - track times"}""")))
        assertEquals(UpdateFound("1.1.14", null), UpdateCheck.found(JSONObject("""{"available":true,"latest":"1.1.14","notes":null}""")))
        assertNull(UpdateCheck.found(JSONObject("""{"available":false,"latest":"1.1.13","current":"1.1.13"}""")))
        assertNull(UpdateCheck.found(JSONObject("""{"available":true,"latest":null}""")))
        assertNull(UpdateCheck.found(null))
    }

    @Test fun `the server's check finding nothing says up to date, or that it failed`() {
        assertEquals("Up to date", UpdateCheck.serverNothing(JSONObject("""{"available":false,"current":"1.1.13","error":null}""")))
        assertEquals("Check failed", UpdateCheck.serverNothing(JSONObject("""{"available":false,"error":"GitHub API HTTP 500"}""")))
        assertEquals("Check failed", UpdateCheck.serverNothing(null))
    }

    @Test fun `a release's server ahead of the app, the app on its way`() {
        val words = UpdateCheck.appNothing("1.1.9", "1.1.8")
        assertEquals("v1.1.9 is on its way — try again in a few minutes", words)
        assertEquals(6_000L, UpdateCheck.holdMs(words))
    }

    @Test fun `a test build's server ahead of the app, where its app is found instead`() {
        for (app in listOf("1.1.9-t3", "1.1.8")) assertEquals("Test builds of the app are on the test-android page", UpdateCheck.appNothing("1.1.9-t5", app))
    }

    @Test fun `the app as new as the server, or newer, or the server not known, is up to date`() {
        assertEquals("Up to date", UpdateCheck.appNothing("1.1.9-t5", "1.1.9-t5"))
        assertEquals("Up to date", UpdateCheck.appNothing("1.1.8", "1.1.9"))
        assertEquals("Up to date", UpdateCheck.appNothing(null, "1.1.9"))
        assertEquals(4_000L, UpdateCheck.holdMs("Up to date"))
    }

    @Test fun `what's new is once for a version both bring, one each for two, none without notes`() {
        val s = UpdateFound("1.1.14", "• Fixed - track times\n• New - Shelf")
        assertEquals(listOf(WhatsNew("What's new in v1.1.14", s.notes!!)), UpdateCheck.whatsNew(s, UpdateFound("1.1.14", s.notes)))
        assertEquals(listOf(WhatsNew("What's new in v1.1.14", s.notes!!)), UpdateCheck.whatsNew(UpdateFound("1.1.14", null), s))
        assertEquals(listOf(WhatsNew("What's new in v1.1.14", s.notes!!)), UpdateCheck.whatsNew(null, s))
        assertEquals(listOf(WhatsNew("What's new in the server's v1.1.14", s.notes!!), WhatsNew("What's new in the app's v1.1.15", "• Fixed - the app")),
            UpdateCheck.whatsNew(s, UpdateFound("1.1.15", "• Fixed - the app")))
        assertEquals(emptyList<WhatsNew>(), UpdateCheck.whatsNew(UpdateFound("1.1.14", null), null))
        assertEquals(emptyList<WhatsNew>(), UpdateCheck.whatsNew(null, null))
    }

    @Test fun `the rows' names`() {
        assertEquals("Server v1.1.13", UpdateCheck.serverName("1.1.13"))
        assertEquals("Server", UpdateCheck.serverName(null))
        assertEquals("1.1.13", UpdateCheck.current(JSONObject("""{"current":"1.1.13"}""")))
        assertNull(UpdateCheck.current(JSONObject("""{"current":null}""")))
        assertNull(UpdateCheck.current(null))
        assertEquals("Android app v1.1.13", UpdateCheck.appName("1.1.13"))
    }
}
