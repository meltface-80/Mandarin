package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** The server's notice worked out by the app as the page's server-notice.js works it out (item 112). */
class ServerNoticesTest {
    private fun of(json: String) = ServerNotices.from(JSONObject(json), Locale.UK)

    @Test fun `all well, or offline, says nothing`() {
        assertNull(of("""{"index_count":120,"sonos":{"rooms":3}}"""))
        assertNull(of("""{"offline":true,"index_count":0}"""))
        assertEquals(60_000L, ServerNotices.nextLook(null, false))
    }

    @Test fun `the data not kept, the first thing said`() {
        val n = of("""{"data_persistent":false,"index_count":0}""")!!
        assertTrue(n.error)
        assertTrue(n.lines[0].startsWith("Your library, album edits and play history are stored inside the container"))
    }

    @Test fun `an empty library, by why`() {
        assertEquals("No music folder at /music. Add your library in Settings → Music folders — or to the docker run command with  -v /path/to/your/Music:/music:ro  and start it again.",
            of("""{"index_count":0,"music_dir_exists":false}""")!!.lines[0])
        val scanning = of("""{"index_count":0,"scan":{"running":true,"files_seen":12345}}""")!!
        assertEquals("Scanning your music folder… 12,345 files so far. Albums appear when the first pass finishes.", scanning.lines[0])
        assertFalse(scanning.error)
        assertEquals(3_000L, ServerNotices.nextLook(scanning, true))
        assertEquals("No audio files were found in /a, /b. Check the -v …:/a, /b:ro mount points at your music, and that the container can read it (4 files couldn't be read).",
            of("""{"index_count":0,"music_dirs":["/a","/b"],"scan":{"last":{"status":"ok","errors":4}}}""")!!.lines[0])
        assertEquals("Starting up — reading your music folder…", of("""{"index_count":0}""")!!.lines[0])
    }

    @Test fun `a music folder gone, with Forget and its question, or Remove the missing ones`() {
        val n = of("""{"index_count":9,"sonos":{"rooms":1},"scan":{"last":{"offline_dirs":[
            {"dir":"/m/a","name":"A","tracks":1200,"missing":true},
            {"dir":"/m/b","name":"B","tracks":3,"reason":"unreadable"},
            {"dir":"/m/c","name":"C","tracks":40,"reason":"vanished"}]}}}""")!!
        assertTrue(n.error)
        assertEquals(3, n.lines.size)
        assertTrue(n.lines[0].startsWith("The music folder “A” isn't there — its 1,200 tracks are kept, not removed."))
        assertTrue(n.lines[1].startsWith("Part of the music folder “B” couldn't be read"))
        assertEquals(listOf("Forget “A”", "Remove the missing ones"), n.buttons)
        assertEquals(listOf("/m/a", "/m/c"), n.dirs)
        assertEquals(listOf("A", "C"), n.names)
        assertEquals("Forget “A”? Its 1,200 tracks and their albums leave the library (they come back with a rescan if the folder does).", n.ask(0))
        assertEquals(30_000L, ServerNotices.nextLook(n, false))
        // Away from home, a folder gone isn't the phone's to say.
        assertNull(of("""{"index_count":9,"away":true,"sonos":{"rooms":0},"scan":{"last":{"offline_dirs":[{"dir":"/m/a","name":"A","tracks":1}]}}}"""))
        assertEquals("Removed 1,200 tracks from “A”", ServerNotices.forgotten(1200, "A", Locale.UK))
    }

    @Test fun `no rooms, unless still looking or away`() {
        val n = of("""{"index_count":9,"sonos":{"rooms":0,"error":"no route"}}""")!!
        assertEquals("No Sonos rooms found yet. The container needs --network host on the same network as your speakers — or set -e SONOS_HOSTS=<a speaker's IP>. (no route)", n.lines[0])
        assertEquals(8_000L, ServerNotices.nextLook(n, false))
        assertNull(of("""{"index_count":9,"sonos":{"rooms":0,"searching":true}}"""))
        assertNull(of("""{"index_count":9,"away":true,"sonos":{"rooms":0}}"""))
    }
}
