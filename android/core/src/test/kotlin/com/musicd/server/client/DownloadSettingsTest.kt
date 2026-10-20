package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Settings → Downloads as the page words it (item 91). */
class DownloadSettingsTest {
    private val albums = DlAlbum.list(JSONArray("""[
        {"id":1,"state":"done","done":9,"total":9,"title":"Album One","artist":"Artist A","quality":"original","bytes":412000000,"auto":false,"image_key":"k1"},
        {"id":2,"state":"downloading","done":3,"total":8,"title":"Hi Res","artist":"Artist B","quality":"opus","bytes":0,"auto":true,"image_key":""}]"""))

    @Test fun `sizes, the lines under the title and the Downloads row`() {
        assertEquals("393 MB", Downloads.size(412000000))
        assertEquals("1.2 GB", Downloads.size(1288490188))
        assertEquals("1 album · 1.2 GB used", Downloads.settingsDesc(albums, 1288490188))
        assertEquals("1 album on this phone · 1.2 GB", Downloads.albumsDesc(albums, 1288490188))
        assertEquals("1 album · 1.2 GB · 1 on the way", Downloads.folderSub(albums, 1288490188))
        assertEquals("Nothing downloaded yet", Downloads.folderSub(emptyList(), 0))
        assertEquals("k1", albums[0].imageKey)
        assertNull(albums[1].imageKey)
    }

    @Test fun `how far each album has come`() {
        assertEquals("9 tracks · 393 MB · Original", Downloads.stateLine(albums[0]))
        assertEquals("Downloading 3 of 8 · Opus 256", Downloads.stateLine(albums[1]))
        assertEquals("9 tracks · 393 MB · Opus 256 · automatic", Downloads.stateLine(albums[0].copy(quality = "opus", auto = true)))
        assertEquals("Waiting for the network · 3 of 8", Downloads.stateLine(albums[1].copy(state = "waiting")))
        assertEquals("Couldn’t download: unknown", Downloads.stateLine(albums[1].copy(state = "failed")))
        assertEquals("On a card that isn’t in · 9 tracks · 393 MB", Downloads.stateLine(albums[0].copy(state = "away")))
        assertEquals("Waiting to start · Original", Downloads.stateLine(albums[0].copy(state = "queued", total = 0)))
    }

    @Test fun `the download folder's rows and notes, and the move`() {
        val s = DlSettings.parse(JSONObject("""{"places":[{"id":"internal","label":"Phone storage","free":21474836480},{"id":"sd","label":"SD card","free":1}],
            "folder":{"access":"needed","name":"Music","chosen":true},"elsewhere":2,"moving":null,"offlineMode":false,"awayQuality":"opus",
            "cacheChoices":{"wifi":[5,10],"mobile":[0,5],"gb":[1,2]}}"""))
        assertEquals(listOf("Download folder: Music", "Save into “Music”", "Android asks for the app to be allowed all files access first — tap Allow, switch it on, and come back.",
            "2 albums are saved elsewhere", "Copied album by album, then removed from where they were. Stopped partway, nothing is lost: each album is whole at one end or the other."),
            Downloads.folderParts(s).map { it.text })
        assertEquals(listOf("choose", "forget"), Downloads.folderParts(s)[0].actions)
        assertEquals("Phone storage · 20.0 GB free", Downloads.places(s)[0].words)
        assertEquals(listOf("5 tracks", "10 tracks"), Downloads.tracks(s.cacheWifiChoices).map { it.words })
        val fresh = DlSettings.parse(JSONObject("""{"moving":{"done":1,"total":3,"error":""}}"""))
        assertEquals(listOf("Download folder", "A folder of your own on the phone or an SD card, as a third place to save to. Albums there outlive the app.", "Moving 2 of 3…"),
            Downloads.folderParts(fresh).map { it.text })
        assertNull(fresh.offlineMode)
        assertNull(fresh.awayQuality)
    }

    @Test fun `the cache's line, the selecting bar, and what is asked`() {
        assertEquals("4 of 20 ahead on the phone · 50 MB used", Downloads.cacheLine(JSONObject("""{"used":52428800,"ahead":4,"wanted":20}""")))
        assertEquals("Nothing queued · 0 MB used", Downloads.cacheLine(JSONObject("{}")))
        assertEquals("Tap albums to select them", Downloads.selected(0))
        assertEquals("Remove 2", Downloads.removeChosen(2))
        assertEquals("Remove “Album One” from this phone?\n\nIt stays in your library on the server.", Downloads.askRemove(listOf("Album One")))
        assertEquals("Remove 2 albums from this phone?\n\nThey stay in your library on the server.", Downloads.askRemove(listOf("a", "b")))
        assertEquals("2 albums removed from this phone", Downloads.removed(2))
        assertEquals(true, Downloads.cacheInfo(10).contains("10 tracks is about 90 MB"))
    }
}
