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

    /** The upload (item 446), in the page's words: none yet, under way (looking, sending, held), and done. */
    @Test fun theUpload() {
        val at = { ms: Long -> "at $ms" }
        val none = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":null}"""), at).upload
        assertEquals(IBroadcastUploadWords(false, "Nothing uploaded from here yet.", "", ""), none)
        val looking = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":true,"files_total":0,"files_done":0,"album":null,"problems":[]}}"""), at)
        assertEquals(IBroadcastUploadWords(true, "Looking at what iBroadcast has…", "", ""), looking.upload)
        assertTrue(looking.again)
        val going = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":true,"held":false,"files_total":120,"files_done":3,
            "bytes_total":2500000000,"bytes_done":45200000,"speed":1250000,"eta":7505,"album":"Artist A – Album One",
            "problems":[{"file":"/music/X/01.aif","why":"iBroadcast doesn't take .aif files"}]}}"""), at).upload
        assertEquals(IBroadcastUploadWords(true, "Uploading Artist A – Album One", "3 of 120 files · 45.2 MB of 2.5 GB · 1.3 MB/s · about 2 h 5 min left",
            "01.aif: iBroadcast doesn't take .aif files"), going)
        val held = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":true,"held":true,"files_total":2,"files_done":1,
            "bytes_total":900,"bytes_done":400,"speed":0,"eta":null,"album":"A – B"}}"""), at).upload
        assertEquals(IBroadcastUploadWords(true, "Paused while music plays", "1 of 2 files · 0 KB of 1 KB", ""), held)
        assertEquals("under a minute left", IBroadcastSettings.left(59))
        assertEquals("about 12 min left", IBroadcastSettings.left(720))
        val done = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":false,"finished":9,"uploaded":7,"already":1,"converted":3,"skipped":1,"failed":1,
            "stopped":false,"error":null,"problems":[{"file":"/m/a.aif","why":"no"},{"file":"/m/b.mp3","why":"too big"}]}}"""), at)
        assertEquals(IBroadcastUploadWords(false, "Done · at 9", "7 uploaded · 1 already in iBroadcast · 3 made FLAC · 1 left out · 1 not sent", "a.aif: no\nb.mp3: too big"), done.upload)
        assertFalse(done.again)
        val stopped = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":false,"finished":4,"uploaded":0,"already":2,"stopped":true}}"""), at).upload
        assertEquals("Stopped · at 4 / 0 uploaded · 2 already in iBroadcast", stopped.status + " / " + stopped.progress)
        val ended = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":false,"finished":4,"uploaded":0,"already":0,"error":"Not signed in to iBroadcast"}}"""), at).upload
        assertEquals("Ended: Not signed in to iBroadcast · at 4", ended.status)
    }

    /** The upload on a schedule (item 447): its switch and hours, and the Library Scanner's beside them, in the page's words. */
    @Test fun theSchedule() {
        val a = IBroadcastSettings.parse(JSONObject("""{"connected":true,"schedule":{"on":true,"start":"22:00","end":"01:00"},"scanner_hours":{"on":true,"start":"01:00","end":"06:00"}}"""))
        assertEquals(listOf("true", "22:00", "01:00", "The Library Scanner runs 01:00–06:00: the upload window can't overlap it."),
            listOf(a.schedule.toString(), a.start, a.end, a.scannerHours))
        assertEquals("Uploads each day between these times, stopping at the end", IBroadcastSettings.scheduleNote(a.schedule))
        val none = IBroadcastSettings.parse(JSONObject("""{"connected":true,"schedule":{"on":false,"start":"22:00","end":"01:00"},"scanner_hours":{"on":false,"start":"01:00","end":"06:00"}}"""))
        assertFalse(none.schedule)
        assertEquals("Off: uploads only when you tap Upload now", IBroadcastSettings.scheduleNote(none.schedule))
        assertEquals("The Library Scanner has no hours (its Schedule is off): give it hours in Library Scanner to upload on a schedule.", none.scannerHours)
        assertEquals("iBroadcast uploads run 22:00–01:00: these hours can't overlap them.", Scanner.uploadNote(JSONObject("""{"start":"22:00","end":"01:00"}""")))
        assertNull(Scanner.uploadNote(null))
    }

    /** What the upload is from and how hard it pushes (item 451), as the page has them; held away from home said so. */
    @Test fun theChoices() {
        val none = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload_settings":{"from":null,"at_once":3,"home":false,"home_at_once":3,"away":false,"away_at_once":1},
            "upload_sources":[{"path":"/m/A","name":"A","files":3},{"path":"/m/B","name":"B","files":2}]}""")).choices
        assertEquals(IBroadcastUploadChoices(null, "Choose All music or a drive to upload from.", 3, false, 3, false, 1, listOf("all" to "All music", "/m/A" to "A", "/m/B" to "B")), none)
        val set = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload_settings":{"from":"/m/B","at_once":2,"home":true,"home_at_once":1,"away":true,"away_at_once":2},"upload_sources":[]}""")).choices
        assertEquals(listOf("/m/B", "", "2", "true", "1", "true", "2"), listOf(set.from, set.fromNote, "${set.atOnce}", "${set.home}", "${set.homeAtOnce}", "${set.away}", "${set.awayAtOnce}"))
        val away = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":true,"held":true,"held_where":"away","files_total":4,"files_done":1,"bytes_total":4000,"bytes_done":1000,"speed":0,"eta":null}}""")).upload
        assertEquals("Paused while music plays away from home", away.status)
        val home = IBroadcastSettings.parse(JSONObject("""{"connected":true,"upload":{"running":true,"held":true,"held_where":"home","files_total":4,"files_done":1,"bytes_total":4000,"bytes_done":1000,"speed":0,"eta":null}}""")).upload
        assertEquals("Paused while music plays", home.status)
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
