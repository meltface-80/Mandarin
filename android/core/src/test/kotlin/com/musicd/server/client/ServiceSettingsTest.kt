package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings → Services as the page says each account (item 87). */
class ServiceSettingsTest {
    private val at = { ms: Long -> "T$ms" }

    @Test fun `Qobuz signed out, and signed in with what the library holds`() {
        val off = ServiceSettings.parse("qobuz", JSONObject("""{"connected":false}"""), at)
        assertEquals("Not signed in.", off.status)
        assertFalse(off.again)
        val on = ServiceSettings.parse("qobuz", JSONObject("""{"connected":true,"user":{"login":"ann@x"},"subscription":"Studio","hires":true,"quality":"hires96","import":true,
            "last_import":{"albums":1,"at":5,"failed":2}}"""), at)
        assertEquals("Signed in as ann@x · Studio · Hi-Res", on.status)
        assertEquals("hires96", on.quality)
        assertEquals("1 Qobuz album in the library · updated T5 · 2 couldn't be read", on.importStatus)
        val fresh = ServiceSettings.parse("qobuz", JSONObject("""{"connected":true,"user":{"name":"Ann"},"lossless":true}"""), at)
        assertEquals("Signed in as Ann · CD quality", fresh.status)
        assertEquals("hires192", fresh.quality)
        assertEquals("The library is brought up to date shortly after signing in.", fresh.importStatus)
        assertTrue(ServiceSettings.parse("qobuz", JSONObject("""{"connected":true,"importing":true}"""), at).again)
    }

    @Test fun `Tidal's sign-in under way, gone wrong, and done`() {
        assertEquals("", ServiceSettings.parse("tidal", JSONObject("{}"), at).status)
        val waiting = ServiceSettings.parse("tidal", JSONObject("""{"pending":{"url":"https://link.tidal.com/ABCDE","code":"ABCDE"}}"""), at)
        assertEquals("Waiting for the sign-in on tidal.com…", waiting.status)
        assertEquals("link.tidal.com/ABCDE", waiting.linkText)
        assertEquals("ABCDE", waiting.pendingCode)
        assertTrue(waiting.again)
        val wrong = ServiceSettings.parse("tidal", JSONObject("""{"pending":{"url":"https://l","error":"Expired"}}"""), at)
        assertEquals("Expired", wrong.status)
        assertFalse(wrong.again)
        val on = ServiceSettings.parse("tidal", JSONObject("""{"connected":true,"subscription":"HIFI_PLUS","import":false,"pending":{"url":"x"}}"""), at)
        assertEquals("Signed in as your account · hifi plus", on.status)
        assertNull(on.pendingUrl)
        assertEquals("Off: your Tidal albums and playlists are not in the library. Switch on to show them.", on.importStatus)
        assertEquals("hires", on.quality)
        val li = ServiceSettings.parse("tidal", JSONObject("""{"connected":true,"last_import":{"albums":3,"at":9,"playlists":1}}"""), at)
        assertEquals("3 Tidal albums in the library · updated T9 · 1 playlist", li.importStatus)
    }

    @Test fun `the lists, the switch's name, and what Update library now says`() {
        assertEquals(listOf("cd", "hires96", "hires192"), ServiceSettings.qualities("qobuz").map { it.value })
        assertEquals("Hi-Res up to 24/192", ServiceSettings.qualities("tidal")[1].words)
        assertEquals("Favourites in the library", ServiceSettings.importName("tidal"))
        assertEquals("12 Qobuz albums in the library", ServiceSettings.updated("qobuz", JSONObject("""{"result":{"albums":12}}""")))
    }
}
