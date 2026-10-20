package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A playlist shared as the page shares it (item 95). */
class TrackShareTest {
    private fun page(n: Int, expanded: Int, done: Boolean) = JSONObject().put("albums_expanded", expanded).put("done", done)
        .put("tracks", org.json.JSONArray((1..n).map { JSONObject("""{"title":"T$it","subtitle":"A","album_title":"B","track_no":$it,"album_offset":4}""") }))

    @Test fun `a Dynamic Playlist read album by album until done`() {
        val asked = ArrayList<Int>()
        val r = TrackShare.gather { o -> asked += o; if (o == 0) page(2, 3, false) else page(1, 2, true) }
        assertEquals(listOf(0, 3), asked)
        assertEquals(3, r.entries.size)
        val e = r.entries[0]
        assertEquals(listOf("T1", "A", "B", "1"), listOf(e.getString("title"), e.getString("artist"), e.getString("album"), e.get("track_no").toString()))
        assertEquals(setOf("title", "artist", "album", "track_no"), e.keySet())
        assertFalse(r.incomplete || r.albumsCapped)
    }

    @Test fun `reading stopped by a failure, by the album cap, or by a page with no albums`() {
        val failed = TrackShare.gather { o -> if (o == 0) page(1, 50, false) else null }
        assertTrue(failed.incomplete)
        assertEquals(1, failed.entries.size)
        val capped = TrackShare.gather { page(1, 50, false) }
        assertTrue(capped.albumsCapped)
        assertEquals(2, capped.entries.size)
        val empty = TrackShare.gather { page(0, 0, false) }
        assertFalse(empty.albumsCapped || empty.incomplete)
        assertTrue(empty.entries.isEmpty())
    }

    @Test fun `the sheet's account, and the file's name`() {
        val a = TrackShare.account(JSONObject("""{"track_count":1,"truncated":true,"skipped":2,"bytes":50000}"""), incomplete = true, albumsCapped = true)
        assertEquals("1 track", a.sum)
        assertEquals(listOf(
            "Reading stopped early because the server returned an error — this file is INCOMPLETE. Try again before sharing it.",
            "Only the first 100 albums were read — that's the limit for one go.",
            "Stopped at the sharing limit of tracks.",
            "2 entries had no title and were left out.",
            "This is 49 KB — too big to paste reliably. Use Download and send the file."), a.warnings)
        assertEquals("3 tracks", TrackShare.account(JSONObject("""{"track_count":3,"skipped":1}""")).sum)
        assertEquals(listOf("1 entry had no title and was left out."), TrackShare.account(JSONObject("""{"track_count":3,"skipped":1}""")).warnings)
        assertEquals("Road_trip_80s_.musicd", TrackShare.fileName("Road trip (80s)"))
        assertEquals("playlist.musicd", TrackShare.fileName(""))
    }
}
