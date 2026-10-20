package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A playlist shared and one imported, as the page says them (item 94). */
class PlaylistShareTest {
    @Test fun `what a share says of itself, and each reason it is less than the whole playlist`() {
        val f = ShareFile.parse(JSONObject("""{"blob":"MDRP1:x","bytes":50000,"track_count":1,"skipped":2,"truncated":true}"""))
        assertEquals("1 track", f.sum)
        assertEquals(listOf("Only the first 100 albums were read — that's the limit for one go.", "Stopped at the sharing limit of tracks.",
            "2 entries had no title and were left out.", "This is 49 KB — too big to paste reliably. Use Download and send the file."),
            f.warnings(ShareCaveats(albumsCapped = true)))
        assertEquals(listOf("1 entry had no title and was left out."), ShareFile("", 10, 3, 1, false).warnings())
        assertEquals("3 tracks", ShareFile("", 10, 3, 0, false).sum)
    }

    @Test fun `what is shared of each track, and the file's name`() {
        val body = PlaylistShare.body("Mine", listOf(PlaylistTrack(5, 0, "Song 1", "Artist A", "Album One", "Artist A", null, 3), PlaylistTrack(5, 1, "Song 2", "", "Album One", "", null)))
        assertEquals("Mine", body.getString("name"))
        val first = body.getJSONArray("tracks").getJSONObject(0)
        assertEquals(listOf("Song 1", "Artist A", "Album One", "3"), listOf("title", "artist", "album", "track_no").map { first.get(it).toString() })
        assertEquals(true, body.getJSONArray("tracks").getJSONObject(1).isNull("track_no"))
        assertEquals("Late_night_mix_.musicd", PlaylistShare.fileName("Late night mix!"))
        assertEquals("playlist.musicd", PlaylistShare.fileName(""))
    }

    @Test fun `what the library made of a shared playlist`() {
        val r = ImportReport.parse(JSONObject("""{"name":"Mine","total":3,"resolved":[{"title":"Song 1"},{"title":"Song 2"}],
            "missing":[{"title":"Nowhere","artist":"Nobody","album":"Nothing"}],"substituted":[{"title":"Song 2","artist":"Artist A","found_album":"Album One"}],"truncated":true}"""))
        assertEquals("2 of 3 tracks found in your library", r.sum)
        assertEquals("1 couldn't be matched:", r.missingWarn)
        assertEquals(listOf("Nowhere · Nobody · Nothing"), r.missingShown)
        assertEquals("1 found on a different album than the playlist named:", r.subNote)
        assertEquals(listOf("Song 2 · Artist A — Album One"), r.substitutedShown)
        assertEquals("Save 2 tracks as a playlist", r.saveLabel)
        val many = ImportReport.parse(JSONObject("""{"total":1,"resolved":[{}],"missing":[${(1..27).joinToString(",") { """{"title":"T$it"}""" }}]}"""))
        assertEquals("Shared playlist", many.name)
        assertEquals("Save 1 track as a playlist", many.saveLabel)
        assertEquals(26, many.missingShown.size)
        assertEquals("…and 2 more", many.missingShown.last())
        assertEquals("Looking inside your albums for the other 27…", many.searching)
        assertNull(many.subNote)
    }

    @Test fun `what is said once tracks are added`() {
        assertEquals("Added 2 tracks to \"Mine\"", PlaylistShare.added(JSONObject("""{"added":2,"name":"Mine"}""")))
        assertEquals("Added 1 track from 2 albums to \"Mine\" — the playlist is now full; 3 couldn't be stored (too long); couldn't read X, Y",
            PlaylistShare.added(JSONObject("""{"added":1,"albums_read":2,"name":"Mine","full":true,"skipped":3,"reason":"too long","albums_failed":["X","Y"]}""")))
    }
}
