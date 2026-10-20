package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The update offer worked out by the app as the page's updater.js works it out (item 111). */
class UpdateBannerTest {
    private fun j(s: String) = JSONObject(s)
    private val server = j("""{"available":true,"latest":"1.4.0","current":"1.3.0","notes":"Fixes."}""")
    private val app = j("""{"available":true,"latest":"1.4.0","current":"1.3.0","installing":false}""")
    private val appNone = j("""{"available":false,"latest":"1.3.0","current":"1.3.0"}""")

    @Test fun `the server and the app, one line, one Update`() {
        val o = UpdateBanner.offer(server, app, "")!!
        assertTrue(o.server && o.app)
        assertEquals("s1.4.0a1.4.0", o.sig)
        assertEquals("v1.4.0 available for the server and this app (you have v1.3.0)", o.banner.text)
        assertEquals("Fixes.", o.banner.notes)
        assertEquals("Update", o.banner.now)
        assertTrue(o.banner.later)
        assertEquals("Server v1.4.0 and app v1.4.1 available",
            UpdateBanner.offer(server, j("""{"available":true,"latest":"1.4.1","current":"1.3.0"}"""), "")!!.banner.text)
    }

    @Test fun `the server alone, its app following, or a roll back`() {
        assertEquals("v1.4.0 available (you have v1.3.0) · the app's v1.4.0 follows in a few minutes", UpdateBanner.offer(server, appNone, "")!!.banner.text)
        assertEquals("v1.4.0 available (you have v1.3.0)", UpdateBanner.offer(server, null, "")!!.banner.text)
        val back = UpdateBanner.offer(j("""{"available":true,"latest":"1.2.0","current":"1.3.0","isDowngrade":true}"""), null, "")!!
        assertEquals("Rollback to v1.2.0 available (you have v1.3.0)", back.banner.text)
        assertEquals("Roll back", back.banner.now)
    }

    @Test fun `the app alone, nothing, or put away by Later`() {
        assertEquals("App v1.4.0 available (you have v1.3.0)", UpdateBanner.offer(j("""{"available":false}"""), app, "")!!.banner.text)
        assertNull(UpdateBanner.offer(j("""{"available":false}"""), appNone, ""))
        assertNull(UpdateBanner.offer(server, app, "s1.4.0a1.4.0"))
        assertNull(UpdateBanner.offer(null, j("""{"available":true,"latest":"1.4.0","installing":true}"""), ""))
    }

    @Test fun `while it runs, when it fails, when it is back`() {
        assertEquals("downloading", UpdateBanner.running(j("""{"apply":{"phase":"downloading"}}""")))
        assertNull(UpdateBanner.running(j("""{"apply":{"phase":"error"}}""")))
        val busy = UpdateBanner.busy("extracting")
        assertEquals("Unpacking…", busy.text)
        assertNull(busy.now)
        assertFalse(busy.later)
        val failed = UpdateBanner.failed("disk full", true)
        assertEquals("Update failed: disk full. Tap Update to retry (the app's update waits for it).", failed.text)
        assertTrue(failed.error)
        assertEquals("Couldn't start update: HTTP 500", UpdateBanner.couldntStart("HTTP 500").text)
        assertTrue(UpdateBanner.back(j("""{"current":"1.4.0","available":false}"""), "1.4.0", false))
        assertTrue(UpdateBanner.back(j("""{"current":"1.3.9","available":false}"""), null, true))
        assertFalse(UpdateBanner.back(j("""{"current":"1.3.0","available":true}"""), "1.4.0", true))
    }
}
