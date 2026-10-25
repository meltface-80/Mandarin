package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Check for updates with the server ahead of the app (bug list item 178). A release's app reaches main's
 * dist/latest.json a few minutes after its server: "on its way" is true then. A test build's (dev's, 1.1.9-tN) never
 * does, its app being on the test-android page: said so rather than promised, the same words as the page's
 * check-update.js (test/check-update-test-build.test.js).
 */
class UpdateCheckTest {
    private fun ahead(server: String, app: String) =
        UpdateCheck.outcome(JSONObject("""{"available":false,"current":"$server"}"""), JSONObject("""{"available":false,"latest":null,"current":"$app"}"""))

    @Test fun `a release's server ahead of the app, the app on its way`() {
        val o = ahead("1.1.9", "1.1.8")
        assertEquals("App v1.1.9 is on its way — try again in a few minutes", o.words)
        assertEquals(false, o.offer)
    }

    @Test fun `a test build's server ahead of the app, where its app is found instead`() {
        val said = "Server v1.1.9-t5 is a test build — the app's test builds are installed from the test-android page"
        for (app in listOf("1.1.9-t3", "1.1.8")) {
            val o = ahead("1.1.9-t5", app)
            assertEquals(said, o.words)
            assertEquals(false, o.offer)
            assertEquals(6_000L, o.holdMs)
        }
    }

    @Test fun `the app the same test build as the server, up to date`() {
        assertEquals("Up to date (server v1.1.9-t5, app v1.1.9-t5)", ahead("1.1.9-t5", "1.1.9-t5").words)
    }
}
