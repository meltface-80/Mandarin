package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Settings → Library Scanner as the page says it (item 90). */
class ScannerTest {
    private val us = Locale.US
    private fun j(s: String) = JSONObject(s)

    @Test fun `the schedule's now, identification's status and progress`() {
        val waiting = j("""{"reason":"waiting","settings":{"start":"01:00"},"progress":{"checked":0,"eligible":1234,"applied":0,"proposed":2,"unidentified":0}}""")
        assertEquals("Now: waiting for 01:00.", Scanner.nowLine(waiting, null))
        assertEquals("Waits for 01:00 (the server's clock).", Scanner.scanStatus(waiting))
        assertEquals("0 of 1,234 albums checked · 0 applied · 2 proposed · 0 unidentified", Scanner.progressLine(waiting, us))
        assertTrue(Scanner.canRecheck(waiting))
        val checking = j("""{"reason":"checking","current":{"artist":"A","title":"One"},"settings":{}}""")
        val measuring = j("""{"reason":"measuring","current":{"subtitle":"B","title":"Two"}}""")
        assertEquals("Now: Identifying A — One · Measuring B — Two", Scanner.nowLine(checking, measuring))
        assertEquals("Checking: A — One", Scanner.scanStatus(checking))
        assertEquals("Now: nothing to do.", Scanner.nowLine(j("""{"reason":"done"}"""), null))
        assertNull(Scanner.progressLine(null))
        assertFalse(Scanner.canRecheck(j("{}")))
    }

    @Test fun `Measure ReplayGain, the processor and the clean-up`() {
        val loud = j("""{"tagged":1200,"measured":5,"left":2,"failed":1,"streamed":1,"reason":"done"}""")
        assertEquals("1,200 tagged · 5 measured · 2 to measure · 1 couldn’t be read", Scanner.loudLine(loud, us))
        assertEquals("1 Qobuz and Tidal track aren’t measured.", Scanner.streamedNote(loud, us))
        assertEquals("Every track is known. New ones are measured as they arrive.", Scanner.loudStatus(null, loud))
        val cpu = j("""{"cores":[0,1,2,3],"split":true,"playback":[0],"background":[1,2,3],"dsp":true}""")
        assertEquals("4 cores · 1 kept for playback (DSP in use) · 3 for scanning and everything else", Scanner.cpuLine(cpu))
        assertEquals("To run playback at a higher priority too, start the container with --cap-add SYS_NICE.", Scanner.cpuNote(cpu))
        assertEquals("1 core, shared", Scanner.cpuLine(j("""{"cores":[0]}""")))
        val clean = j("""{"files":{"albums":1,"tracks":12,"folders":1},"qobuz":{"albums":0,"signed_in":true}}""")
        assertEquals("Remove 1 album", Scanner.cleanupButton(clean, "files", us))
        assertNull(Scanner.cleanupButton(clean, "qobuz", us))
        assertEquals("1 album (12 tracks) in 1 folder the scanner couldn’t find.", Scanner.filesNote(clean, us))
        assertEquals("Qobuz albums neither in your favourites or purchases nor needed by a playlist.", Scanner.servicesNote(clean))
        assertEquals("…", Scanner.filesNote(null, us))
    }

    @Test fun `the MusicBrainz pack, downloaded, downloading and not`() {
        val day = { iso: String -> "D($iso)" }
        val have = Scanner.pack(j("""{"installed":{"releases":2500000,"built":"2026-10-12","size":3145728000},"newer":true}"""), false, day, us)
        assertEquals("2,500,000 releases · from D(2026-10-12) · 3,000 MB · a newer one is out", have.state)
        assertEquals(listOf("Update", "Remove"), have.buttons.map { it.label })
        assertTrue(have.buttons[0].primary)
        val going = Scanner.pack(j("""{"job":{"phase":"download","done":52428800,"total":104857600}}"""), false, day, us)
        assertEquals("Downloading… 50 % (50 MB of 100 MB)", going.state)
        assertTrue(going.following)
        val none = Scanner.pack(j("""{"latest":{"gz_size":104857600,"size":1048576000},"free":10}"""), false, day, us)
        assertEquals("Not downloaded. A 100 MB download that unpacks to 1,000 MB in the folder below.", none.state)
        assertEquals("Not enough room in this folder: choose another below.", none.error)
        assertTrue(none.enabled)
        val offline = Scanner.pack(j("""{"check_error":"fetch failed"}"""), false, day, us)
        assertEquals("Not downloaded. (fetch failed)", offline.state)
        assertFalse(offline.enabled)
        assertEquals("/data (the data folder) · 1 MB free" to null, Scanner.packFolder(j("""{"dir":"/data","data_dir":"/data","free":1048576}"""), us))
        assertEquals("/x" to "Can't write here", Scanner.packFolder(j("""{"dir":"/x","data_dir":"/data","dir_problem":"Can't write here"}"""), us))
    }

    @Test fun `an album's line on each list`() {
        val proposed = j("""{"candidate":{"artist":"A","title":"One (Remastered)","year":1988,"edition":"2015 remaster","release_year":2015,"parts":{"missing_tracks":1}},
            "similarity":78,"why":["track lengths differ"],"ambiguous":true}""")
        assertEquals("→ A — One (Remastered) (1988) · 2015 remaster, released 2015, 1 track of the release missing here · 78 % alike — track lengths differ · two releases fit",
            Scanner.line2(proposed, "proposed", true))
        assertEquals("nothing with this title on MusicBrainz or iTunes", Scanner.line2(j("{}"), "unidentified", true))
        assertEquals("nothing with this title on MusicBrainz", Scanner.line2(j("{}"), "unidentified", false))
        val applied = j("""{"scanned":{"artist":"a","title":"one"},"candidate":{"year":2001,"matched_by":"isrc","from_pack":true}}""")
        assertEquals("was a — one · 2001 · matched by ISRCs (pack)", Scanner.line2(applied, "applied", true))
        assertEquals("was a — one · matched by you", Scanner.line2(j("""{"scanned":{"artist":"a","title":"one"},"candidate":{"manual":"pick"}}"""), "applied", true))
        assertEquals("declined: D — Four Live", Scanner.line2(j("""{"candidate":{"artist":"D","title":"Four Live"}}"""), "rejected", true))
        assertEquals(listOf("Accept", "Reject"), Scanner.actions("proposed").map { it.label })
        assertEquals(100, Scanner.showAll("applied", 300))
        assertEquals("2,3,4,5,6", Scanner.countsOf(j("""{"progress":{"checked":2,"applied":3,"proposed":4,"unidentified":5,"rejected":6}}""")))
    }
}
