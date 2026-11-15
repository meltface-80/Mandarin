package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Edit album's Folders and copies and Library clean-up's merged albums (item 424), as the server answers and the page says them. */
class AlbumSplitEditTest {
    private val state = EditState.parse(JSONObject("""{"offset":7,"title":"Moanin'","artist":"Art Blakey","art":{"own":true},
        "split":{"folders":[{"folder":"Moanin' (1959) (SACD Version)","tracks":7},{"folder":"Moanin' (1959) (Remastered 2013)","tracks":6}],
                 "ways":[{"by":"words","name":"By the version words in the titles","parts":[{"name":"SACD Version","tracks":7},{"name":"Remastered 2013","tracks":6}]}],
                 "part":false}}"""))

    @Test fun `the folders and the ways read, said as the page says them`() {
        val s = state.split!!
        assertTrue(s.byFolder)
        assertFalse(s.part)
        assertEquals("Its tracks are in 2 folders: Moanin' (1959) (SACD Version) (7) · Moanin' (1959) (Remastered 2013) (6)", s.foldersLine)
        assertEquals(listOf("words"), s.ways.map { it.by })
        assertEquals("By the version words in the titles: SACD Version (7) · Remastered 2013 (6)", s.ways[0].line)
    }

    @Test fun `one folder offers no Split by folder, and a server from before says nothing`() {
        val one = AlbumSplitEdit.parse(JSONObject("""{"folders":[],"ways":[],"part":true}"""))!!
        assertFalse(one.byFolder)
        assertNull(one.foldersLine)
        assertTrue(one.part)
        assertNull(EditState.parse(JSONObject("""{"offset":1}""")).split)
    }

    @Test fun `what is said once done, and the albums an answer names`() {
        assertEquals(listOf(7L, 9L), AlbumSplitEdit.albums(JSONObject("""{"ok":true,"albums":[7,9]}""")))
        assertEquals("Split into 2 albums — each a version of the others. Join back puts them together again.", AlbumSplitEdit.said("split", 2))
        assertEquals("Joined back into one album.", AlbumSplitEdit.said("join", 1))
        assertEquals("Looked at again: its tracks are in 2 albums now.", AlbumSplitEdit.said("look-again", 2))
        assertEquals("Looked at again: nothing to change.", AlbumSplitEdit.said("look-again", 1))
        assertEquals("Album split", AlbumSplitEdit.toast("split"))
    }

    @Test fun `Library clean-up's list, its line, its title and each album's why`() {
        val m = AlbumSplitEdit.merged(JSONObject("""{"count":2,"albums":[
            {"offset":7,"title":"Moanin'","artist":"Art Blakey","tracks":13,"folders":2,"repeats":true},
            {"offset":8,"title":"Twice","artist":"","tracks":4,"folders":1,"repeats":true}]}"""))
        assertEquals(2, m.count)
        assertEquals("2 albums look like two copies merged", AlbumSplitEdit.mergedLine(m.count))
        assertEquals("1 album looks like two copies merged", AlbumSplitEdit.mergedLine(1))
        assertNull(AlbumSplitEdit.mergedLine(0))
        assertEquals("Look like two copies merged (2)", AlbumSplitEdit.mergedTitle(2))
        assertEquals("Art Blakey — Moanin'", m.albums[0].name)
        assertEquals("2 folders · a track number twice on a disc · 13 tracks", m.albums[0].why)
        assertEquals("Twice", m.albums[1].name)
        assertEquals("a track number twice on a disc · 4 tracks", m.albums[1].why)
    }
}
