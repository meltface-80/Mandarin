package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Settings → Music Folders in the page's words (item 88). */
class FolderSettingsTest {
    private val us = Locale.US

    @Test fun `the server's folders, each with how many tracks, or that it isn't there or can't be read`() {
        val f = FolderSettings.parse(JSONObject("""{"folders":[{"path":"/music","name":"music","exists":true,"readable":true,"tracks":12345,"hint":null},
            {"path":"/mnt/nas","name":"nas","exists":false,"readable":false,"tracks":0,"hint":"Mount it first"},
            {"path":"/srv/a","name":"a","exists":true,"readable":false,"tracks":3}],"scanning":true,"docker":true,"mounts":[{"path":"/mnt/nas","waiting":true}]}"""))
        assertEquals("12,345 tracks", f.folders[0].state(us))
        assertFalse(f.folders[0].bad)
        assertNull(f.folders[0].hint)
        assertEquals("Not there — its albums are kept", f.folders[1].state(us))
        assertEquals("Mount it first", f.folders[1].hint)
        assertEquals("Can’t be read — its albums are kept", f.folders[2].state(us))
        assertTrue(f.folders[2].bad)
        assertTrue(f.removable && f.scanning && f.docker)
        assertEquals(listOf(Mount("/mnt/nas", true)), f.mounts)
        assertFalse(FolderSettings.parse(JSONObject("""{"folders":[{"path":"/music","tracks":1}]}""")).removable)
    }

    @Test fun `choosing a folder to add, and the answers to an add or a remove`() {
        val b = FolderSettings.browsed(JSONObject("""{"path":"/mnt/nas/Music","parent":"/mnt/nas","dirs":[{"name":"Jazz","path":"/mnt/nas/Music/Jazz"}]}"""))
        assertEquals("/mnt/nas", b.parent)
        assertEquals("Jazz" to "/mnt/nas/Music/Jazz", b.dirs[0])
        assertNull(FolderSettings.browsed(JSONObject("""{"path":"/","parent":null,"dirs":[]}""")).parent)
        val f = FolderSettings.parse(JSONObject("""{"folders":[{"path":"/music","name":"music","tracks":2}],"docker":true,"mounts":[{"path":"/mnt"}]}"""))
        assertEquals("/music", FolderSettings.inside(f, "/music/Jazz"))
        assertNull(FolderSettings.inside(f, "/musical"))
        assertEquals("Add “Music”", FolderSettings.chooseWords("/mnt/nas/Music"))
        assertEquals("Add “/”", FolderSettings.chooseWords("/"))
        val after = FolderSettings.after(f, JSONObject("""{"ok":true,"folders":[{"path":"/music"},{"path":"/b"}],"scanning":true}"""))
        assertEquals(2, after.folders.size)
        assertTrue(after.docker && after.scanning)
        assertEquals("Removed “music” — 1,200 tracks", FolderSettings.removed(f.folders[0], JSONObject("""{"removed":1200}"""), us))
        assertTrue(FolderSettings.removeQuestion(f.folders[0], us).startsWith("Remove “music” from the library?\n\nIts 2 tracks"))
    }

    @Test fun `the note, in a container or not, and the phone's own folder`() {
        assertEquals(listOf("-v /mnt:/mnt:ro,rslave", "rslave"), FolderSettings.note(true).filter { it.second }.map { it.first })
        assertEquals(1, FolderSettings.note(false).size)
        val at = { ms: Long -> "T$ms" }
        assertEquals("1 album · 12 tracks · read T5", FolderSettings.localState(LocalFolder("Music", 1, 12, false, 5, true, null), at))
        assertEquals("2 albums · 1 track · read never", FolderSettings.localState(LocalFolder("Music", 2, 1, false, 0, true, null), at))
        assertEquals("Reading the folder…", FolderSettings.localState(LocalFolder("Music", 2, 1, true, 0, false, null), at))
        assertEquals("Not reachable right now — its card may be out", FolderSettings.localState(LocalFolder("Music", 2, 1, false, 0, false, null), at))
    }
}
