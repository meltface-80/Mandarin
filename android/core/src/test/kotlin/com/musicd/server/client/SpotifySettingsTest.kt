package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread

class SpotifySettingsTest {
    @Test fun `signed out, signed in, the import's words as the page's`() {
        val off = SpotifySettings.parse(JSONObject("""{"connected":false,"import":false}"""), { "x" })
        assertFalse(off.connected)
        assertEquals("", off.status)
        val on = SpotifySettings.parse(JSONObject("""{"connected":true,"import":true,"importing":false,"user":{"name":"A Listener","login":"listener1"},
            "last_import":{"albums":3,"at":1}}"""), { "21 Nov 2026, 15:00" })
        assertEquals("Signed in as A Listener", on.status)
        assertEquals("3 Spotify albums in the library · updated 21 Nov 2026, 15:00", on.importStatus)
        assertFalse(on.again)
        val busy = SpotifySettings.parse(JSONObject("""{"connected":true,"import":true,"importing":true,"user":{"login":"listener1"}}"""), { "" })
        assertEquals("Signed in as listener1", busy.status)
        assertTrue(busy.again)
        assertEquals("Off: your Spotify albums are not in the library. Switch on to show them.",
            SpotifySettings.parse(JSONObject("""{"connected":true,"import":false}"""), { "" }).importStatus)
        assertEquals("5 Spotify albums in the library", SpotifySettings.updated(JSONObject("""{"result":{"albums":5}}""")))
    }

    private fun freePort() = ServerSocket(0).use { it.localPort }
    private fun get(url: String): Int = (URL(url).openConnection() as HttpURLConnection).run { connectTimeout = 3000; readTimeout = 3000; val c = responseCode; disconnect(); c }

    @Test fun `the browser's return caught on this phone, whole, another path waited past`() {
        val port = freePort()
        var caught: String? = null
        val t = thread { caught = SpotifySettings.catchAnswer(10_000, port) }
        Thread.sleep(300)
        assertEquals(404, get("http://127.0.0.1:$port/favicon.ico"))
        assertEquals(200, get("http://127.0.0.1:$port/mandarin-spotify?code=abc&state=xyz"))
        t.join(5000)
        assertEquals("http://127.0.0.1:$port/mandarin-spotify?code=abc&state=xyz", caught)
    }

    @Test fun `nothing caught when let go, or when nothing comes in time`() {
        val port = freePort()
        var stop = false
        var caught: String? = "x"
        val t = thread { caught = SpotifySettings.catchAnswer(30_000, port) { stop } }
        Thread.sleep(300)
        stop = true
        t.join(5000)
        assertFalse(t.isAlive)
        assertNull(caught)
        assertNull(SpotifySettings.catchAnswer(1200, freePort()))
    }
}
