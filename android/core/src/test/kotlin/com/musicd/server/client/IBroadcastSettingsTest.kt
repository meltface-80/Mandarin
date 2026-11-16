package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings → Services → iBroadcast (item 443): the account as the server says it, in the page's words. */
class IBroadcastSettingsTest {
    @Test fun signedIn() {
        val a = IBroadcastSettings.parse(JSONObject("""{"connected":true,"user":{"name":"tester"},"premium":true,"formats":["flac","mp3","wav"]}"""))
        assertEquals(listOf("Signed in as tester", "Yes: your files play as they are", "FLAC, MP3, WAV"), listOf(a.status, a.premium, a.formats))
        assertNull(a.pendingUrl)
        assertFalse(a.again)
        val free = IBroadcastSettings.parse(JSONObject("""{"connected":true,"user":{},"premium":false,"formats":[]}"""))
        assertEquals(listOf("Signed in as your account", "No: iBroadcast plays everything as 128 kbps MP3", "iBroadcast didn't say"), listOf(free.status, free.premium, free.formats))
        assertEquals("iBroadcast didn't say", IBroadcastSettings.parse(JSONObject("""{"connected":true,"premium":null}""")).premium)
    }

    /** What the library holds of iBroadcast (item 444), in the page's words. */
    @Test fun theLibrary() {
        val at = { ms: Long -> "at $ms" }
        val a = IBroadcastSettings.parse(JSONObject("""{"connected":true,"library":{"import":true,"reading":false,"albums":12,"also_here":3,"tracks":140,"at":5}}"""), at)
        assertEquals("12 albums in iBroadcast · 3 of them here as files too, shown once · updated at 5", a.libraryStatus)
        assertTrue(a.import)
        assertFalse(a.again)
        val one = IBroadcastSettings.parse(JSONObject("""{"connected":true,"library":{"import":true,"albums":1,"also_here":0,"at":7}}"""), at)
        assertEquals("1 album in iBroadcast · updated at 7", one.libraryStatus)
        val reading = IBroadcastSettings.parse(JSONObject("""{"connected":true,"library":{"import":true,"reading":true}}"""), at)
        assertEquals(listOf("Reading your iBroadcast library…", "true"), listOf(reading.libraryStatus, reading.again.toString()))
        val off = IBroadcastSettings.parse(JSONObject("""{"connected":true,"library":{"import":false,"albums":4}}"""), at)
        assertEquals("Off: your iBroadcast albums are not in the library. Switch on to show them.", off.libraryStatus)
        assertFalse(off.import)
        assertEquals("Your iBroadcast library is read shortly after signing in.", IBroadcastSettings.parse(JSONObject("""{"connected":true,"library":{"import":true}}"""), at).libraryStatus)
    }

    @Test fun aSignInUnderWay() {
        val a = IBroadcastSettings.parse(JSONObject("""{"connected":false,"pending":{"url":"https://media.ibroadcast.com/device?code=AB12","code":"AB12","error":null}}"""))
        assertEquals(listOf("Waiting for Mandarin to be approved on iBroadcast…", "media.ibroadcast.com/device?code=AB12", "AB12"), listOf(a.status, a.linkText, a.pendingCode))
        assertTrue(a.again)
        val failed = IBroadcastSettings.parse(JSONObject("""{"connected":false,"pending":{"url":"https://x","code":"C","error":"The code expired: sign in again for a new one"}}"""))
        assertEquals("The code expired: sign in again for a new one", failed.status)
        assertFalse(failed.again)
        val out = IBroadcastSettings.parse(JSONObject("""{"connected":false}"""))
        assertEquals(listOf("", "", ""), listOf(out.status, out.premium, out.formats))
    }
}
