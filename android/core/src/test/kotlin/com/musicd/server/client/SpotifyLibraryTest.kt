package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Settings → Services → Spotify, your library (item 143): as the page says it, and Spotify's answer caught on the phone. */
class SpotifyLibraryTest {
    private val at = { ms: Long -> "T$ms" }

    @Test fun `signed out, a sign-in under way, and signed in with what the library holds`() {
        val off = SpotifyLibraries.parse(JSONObject("""{"connected":false,"client_id":"abc"}"""), at)
        assertEquals("Not signed in.", off.status)
        assertEquals("abc", off.clientId)
        assertNull(off.pendingUrl)
        val waiting = SpotifyLibraries.parse(JSONObject("""{"connected":false,"pending":{"url":"https://accounts/authorize?x"}}"""), at)
        assertEquals("Waiting for Spotify's answer…", waiting.status)
        assertEquals("https://accounts/authorize?x", waiting.pendingUrl)
        val on = SpotifyLibraries.parse(JSONObject("""{"connected":true,"user":{"name":"Ann","login":"ann1"},"import":true,"last_import":{"albums":1,"at":5},"pending":{"url":"x"}}"""), at)
        assertEquals("Signed in as Ann", on.status)
        assertNull(on.pendingUrl)
        assertEquals("1 Spotify album in the library · updated T5", on.importStatus)
        assertEquals("Off: your Spotify albums and playlists are not in the library. Switch on to show them.",
            SpotifyLibraries.parse(JSONObject("""{"connected":true,"import":false}"""), at).importStatus)
        val busy = SpotifyLibraries.parse(JSONObject("""{"connected":true,"user":{"login":"ann1"},"importing":true}"""), at)
        assertEquals("Signed in as ann1", busy.status)
        assertTrue(busy.importing)
        assertEquals(SpotifyLibraries.IMPORTING, busy.importStatus)
    }

    private fun get(url: String): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        return try { c.responseCode to (if (c.responseCode < 400) c.inputStream else c.errorStream).bufferedReader().readText() } finally { c.disconnect() }
    }

    @Test fun `Spotify's answer is caught on the phone's loopback address, and nothing else is`() {
        val catcher = SpotifyCatch(port = 43177)
        var caught: String? = "not yet"
        val t = thread { caught = catcher.await(10_000) }
        Thread.sleep(300)
        val (stray, _) = get("http://127.0.0.1:43177/favicon.ico")
        assertEquals(404, stray)
        val (status, body) = get("http://127.0.0.1:43177/mandarin-spotify?code=AQB1&state=s1")
        t.join()
        assertEquals(200, status)
        assertTrue(body.contains("Signed in to Spotify"))
        assertEquals("http://127.0.0.1:43177/mandarin-spotify?code=AQB1&state=s1", caught)
    }

    @Test fun `no answer within the time is none`() {
        assertNull(SpotifyCatch(port = 43178).await(300))
    }

    @Test fun `the stream quality, lossless unless another is chosen`() {
        assertEquals("lossless", SpotifyLibraries.parse(JSONObject("""{"connected":false}"""), at).quality)
        assertEquals("high", SpotifyLibraries.parse(JSONObject("""{"connected":false,"quality":"high"}"""), at).quality)
        assertEquals("lossless", SpotifyLibraries.parse(JSONObject("""{"connected":true,"quality":"best"}"""), at).quality)
        assertEquals(listOf("lossless", "very_high", "high", "normal"), SpotifyLibraries.QUALITIES.map { it.value })
    }
}
