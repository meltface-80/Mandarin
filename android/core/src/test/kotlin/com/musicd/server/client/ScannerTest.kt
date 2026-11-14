package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Settings → Library Scanner as the page says it (items 90 and 411). */
class ScannerTest {
    private val us = Locale.US
    private fun j(s: String) = JSONObject(s)

    @Test fun `the Album Scanner's switch and its note, moved as it is tapped`() {
        val on = j("""{"on":true,"schedule":{"on":true,"start":"01:00","end":"06:00"},"albums":3,"done":0,"unidentified":1,"proposed":0,"now":{"reason":"waiting"}}""")
        assertEquals("Identifies albums, measures ReplayGain and finds missing covers, while nothing plays.", Scanner.note(on))
        val off = Scanner.withScanner(on, j("""{"on":false}"""))!!
        assertFalse(off.optBoolean("on"))
        assertTrue("the schedule as it was", off.getJSONObject("schedule").getBoolean("on"))
        assertEquals("Identifies albums, measures ReplayGain and finds missing covers, while nothing plays. Off: none of this is done.", Scanner.note(off))
        assertTrue("the state itself untouched", on.optBoolean("on"))
        // Schedule's own switch, and its hours.
        val any = Scanner.withScanner(on, j("""{"schedule":false}"""))!!
        assertTrue(any.optBoolean("on"))
        assertFalse(any.getJSONObject("schedule").getBoolean("on"))
        assertEquals("02:30", Scanner.withScanner(on, j("""{"start":"02:30"}"""))!!.getJSONObject("schedule").getString("start"))
        assertEquals("Runs only between these times", Scanner.scheduleNote(true))
        assertEquals("Off: runs any time, day and night", Scanner.scheduleNote(false))
        assertNull(Scanner.withScanner(null, j("""{"on":true}""")))
        assertEquals(Scanner.NOTE, Scanner.note(null))
    }

    @Test fun `one readout, the albums with every step done, and what it is doing now`() {
        val s = j("""{"albums":14119,"done":9960,"schedule":{"on":true,"start":"01:00"},"now":{"reason":"working","step":"measuring loudness","album":{"offset":7,"artist":"U2","title":"Pop"}}}""")
        assertEquals("9,960 of 14,119 albums · 70%", Scanner.progressCount(s, us))
        assertEquals(70, Scanner.percent(s))
        assertEquals(99, Scanner.percent(j("""{"albums":1000,"done":999}""")))
        assertEquals(0, Scanner.percent(j("""{"albums":0,"done":0}""")))
        assertEquals("1 of 1 album · 100%", Scanner.progressCount(j("""{"albums":1,"done":1}"""), us))
        assertNull(Scanner.progressCount(null, us))
        assertEquals("Now: U2 — Pop · measuring loudness", Scanner.nowLine(s))
        fun at(reason: String, more: String = "") = Scanner.nowLine(j("""{"schedule":{"on":true,"start":"01:00"},"now":{"reason":"$reason"$more}}"""))
        assertEquals("Now: Untitled · identifying", at("working", ""","step":"identifying","album":{"artist":"","title":"Untitled"}"""))
        assertEquals("Now: on to the next album", at("working", ""","step":null,"album":null"""))
        assertEquals("Waiting for 01:00", at("waiting"))
        assertEquals("Paused while music plays", at("playing"))
        assertEquals("Paused while the library is scanned", at("scanning"))
        assertEquals("MusicBrainz isn't answering; trying again in a few minutes", at("unreachable"))
        assertEquals("All done", at("done"))
        assertEquals("The rest are looked at again after the next library scan, or at night", at("later"))
        assertEquals("Off", at("off"))
        // Items 410 and 411: the music folders the cover finder can't reach, under the readout, three at most named.
        assertEquals("The music folders can't be reached (/music/1tb/Music, /music/2tb/Music not found): covers will be looked for once they are.",
            Scanner.coversUnreachable(j("""{"unreachable":["/music/1tb/Music","/music/2tb/Music"]}""")))
        assertEquals("The music folders can't be reached (/a, /b, /c, … not found): covers will be looked for once they are.",
            Scanner.coversUnreachable(j("""{"unreachable":["/a","/b","/c","/d"]}""")))
        assertNull(Scanner.coversUnreachable(j("""{"unreachable":[]}""")))
        assertNull(Scanner.coversUnreachable(s))
    }

    @Test fun `the folders, Unidentified always, To confirm only while there are proposals`() {
        val both = Scanner.folders(j("""{"unidentified":1204,"proposed":3}"""))
        assertEquals(listOf("Unidentified" to 1204, "To confirm" to 3), both.map { it.title to it.count })
        assertEquals(listOf("Tap to place them by hand", "Found, but not sure enough to apply unasked"), both.map { it.sub })
        assertEquals(listOf("unidentified"), Scanner.folders(j("""{"unidentified":0,"proposed":0}""")).map { it.kind })
        assertEquals("None to place by hand", Scanner.folders(j("""{"unidentified":0,"proposed":0}"""))[0].sub)
        assertEquals(emptyList<ScanFolder>(), Scanner.folders(null))
        assertEquals("2,3,4", Scanner.countsOf(j("""{"done":2,"unidentified":3,"proposed":4}""")))
        assertEquals(500, Scanner.showAll(1204))
        assertEquals(12, Scanner.showAll(12))
    }

    @Test fun `the processor and the clean-up`() {
        val cpu = j("""{"cores":[0,1,2,3],"split":true,"playback":[0],"background":[1,2,3],"dsp":true}""")
        assertEquals("4 cores · 1 kept for playback (DSP in use) · 3 for the rest", Scanner.cpuLine(cpu))
        assertEquals(" To run playback at a higher priority too, give the server the SYS_NICE capability.", Scanner.cpuHint(cpu))
        assertEquals(" Playback also runs at a higher priority here.", Scanner.cpuHint(j("""{"cores":[0,1],"split":true,"raised":true}""")))
        assertEquals("1 core, shared; playback comes first by priority", Scanner.cpuLine(j("""{"cores":[0]}""")))
        assertEquals("", Scanner.cpuHint(j("""{"cores":[0]}""")))
        assertNull(Scanner.cpuLine(null))
        // Item 260: a making under way said; the cores for it chosen where the cores are split.
        val making = j("""{"cores":[0,1,2,3],"split":true,"playback":[1,2,3],"background":[0],"dsp":true,"making":true,"making_cores":2}""")
        assertEquals("4 cores · 3 kept for playback (making as it plays) · 1 for the rest", Scanner.cpuLine(making))
        assertEquals(listOf("auto", "1", "2", "3"), Scanner.makingChoices(making).map { it.value })
        assertEquals("2", Scanner.makingCurrent(making))
        assertEquals("auto", Scanner.makingCurrent(cpu))
        assertEquals(listOf("Auto", "1", "2"), Scanner.makingChoices(j("""{"cores":[0,1,2],"split":true}""")).map { it.label })
        assertEquals(emptyList<SegChoice>(), Scanner.makingChoices(j("""{"cores":[0,1],"split":false}""")))
        val clean = j("""{"files":{"albums":23,"tracks":240,"folders":3},"qobuz":{"albums":1,"signed_in":false},"tidal":{"albums":0}}""")
        assertEquals(listOf(CleanupRow("files", "23 albums whose files are gone", 23), CleanupRow("qobuz", "1 Qobuz album (signed out of Qobuz)", 1)), Scanner.cleanupRows(clean, us))
        assertEquals("2 Tidal albums no longer wanted", Scanner.cleanupRows(j("""{"tidal":{"albums":2}}"""), us).single().words)
        assertEquals(emptyList<CleanupRow>(), Scanner.cleanupRows(j("""{"files":{"albums":0},"qobuz":{"albums":0,"signed_in":true}}"""), us))
        assertTrue(Scanner.cleanupQuestion("tidal", 2, us).startsWith("Remove 2 Tidal albums from the database?"))
        assertTrue(Scanner.cleanupQuestion("files", 1, us).startsWith("Remove 1 album whose files are gone from the server?"))
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
        assertEquals("Not enough room in this folder: choose another.", none.error)
        assertTrue(none.enabled)
        val offline = Scanner.pack(j("""{"check_error":"fetch failed"}"""), false, day, us)
        assertEquals("Not downloaded. (fetch failed)", offline.state)
        assertFalse(offline.enabled)
        assertEquals("/data (the data folder) · 1 MB free" to null, Scanner.packFolder(j("""{"dir":"/data","data_dir":"/data","free":1048576}"""), us))
        assertEquals("/x" to "Can't write here", Scanner.packFolder(j("""{"dir":"/x","data_dir":"/data","dir_problem":"Can't write here"}"""), us))
        // What the server says as null is nothing to say, never the word "null" (item 103: "/packs · 237,242 MB free null").
        // Read as the phone reads it: Android's org.json gives "null" for a JSON null where this one gives "".
        assertEquals("/packs · 1 MB free" to null, Scanner.packFolder(AndroidJson("""{"dir":"/packs","data_dir":"/data","free":1048576,"dir_problem":null,"job":{"error":null}}"""), us))
        assertEquals("/packs · 1 MB free" to null, Scanner.packFolder(AndroidJson("""{"dir":"/packs","data_dir":"/data","free":1048576,"dir_problem":null}"""), us))
        assertEquals("Not downloaded.", Scanner.pack(AndroidJson("""{"check_error":null}"""), false, day, us).state)
        val quiet = Scanner.pack(AndroidJson("""{"installed":{"releases":1,"built":"2026-10-15","size":1048576},"job":{"phase":null,"error":null}}"""), false, day, us)
        assertEquals(null, quiet.error)
        // The readout's album and step, read the same way: a null step is no step.
        assertEquals("Now: on to the next album", Scanner.nowLine(AndroidJson("""{"now":{"reason":"working","step":null,"album":null}}""")))
    }

    /** A JSON object as Android's org.json answers it: a JSON null read as text is the word "null", in it and in the objects in it. */
    private class AndroidJson(text: String) : JSONObject(text) {
        override fun optString(key: String): String = optString(key, "")
        override fun optString(key: String, fallback: String): String = if (has(key) && isNull(key)) "null" else super.optString(key, fallback)
        override fun optJSONObject(key: String): JSONObject? = super.optJSONObject(key)?.let { AndroidJson(it.toString()) }
    }

    @Test fun `an album's line in each folder, and its actions`() {
        val proposed = j("""{"candidate":{"artist":"A","title":"One (Remastered)","year":1988,"edition":"2015 remaster","release_year":2015,"parts":{"missing_tracks":1}},
            "similarity":78,"why":["track lengths differ"],"ambiguous":true}""")
        assertEquals("→ A — One (Remastered) (1988) · 2015 remaster, released 2015, 1 track of the release missing here · 78 % alike — track lengths differ · two releases fit",
            Scanner.line2(proposed, "proposed"))
        assertEquals("nothing with this title on MusicBrainz or iTunes", Scanner.line2(j("{}"), "unidentified"))
        assertEquals("nearest: B — Two · 40 % · from iTunes", Scanner.line2(j("""{"candidate":{"artist":"B","title":"Two","source":"itunes"},"similarity":40}"""), "unidentified"))
        assertEquals(listOf("Accept", "Reject"), Scanner.actions("proposed").map { it.label })
        assertEquals(listOf("Check again"), Scanner.actions("unidentified").map { it.label })
        assertEquals("Applied", Scanner.actDone("accept"))
        assertNull(Scanner.actDone("undo"))
    }
}
