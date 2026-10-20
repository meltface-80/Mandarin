package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.random.Random

/**
 * The library offline (item 106): what is on the phone, answered as the server would and read by the app's own client
 * ([LibraryClient] over a [LocalTransport]), so each answer is one the native screens read.
 */
class PhoneShelfTest {
    private val saved = JSONObject("""{"album":{"offset":7,"title":"Blue Train","subtitle":"John Coltrane","image_key":"al-7","year":1958},
        "tracks":[{"title":"Blue Train","subtitle":"10:43","length":643,"track_id":700}],"actions":[{"kind":"play_now","title":"Play Now"}],"artists":["John Coltrane"]}""")
    private val shelf = PhoneShelf(listOf(
        ShelfAlbum(7, "Blue Train", "John Coltrane", 1958, "al-7", 300, listOf(ShelfTrack(70, "Blue Train", 643.0)), saved),
        ShelfAlbum(3, "Abbey Road", "The Beatles", 1969, null, 100, listOf(ShelfTrack(30, "Come Together", 259.6), ShelfTrack(31, "Something", 182.0))),
        ShelfAlbum(5, "Kind of Blue", "Miles Davis", null, "k5", 200, emptyList()),
    ), PhoneMusic(listOf(PhoneAlbum("ab12", "Home Tapes", "Me", 2020, true, listOf(PhoneTrack("One", "Me", 61.0, "flac", 96000, 24)))), "Music", false, 42), Random(1))

    private val client = ServerClient(ServerAddress("phone", 0), transport = LocalTransport { _, path, q, _ -> shelf.get(path, q) ?: Answer.error(404, "not here") })
    private val lib = LibraryClient(client)

    @Test fun `the library's wall, sorted and paged as the server's`() {
        val page = lib.albums()
        assertEquals(3, page.total)
        assertEquals(listOf("Abbey Road", "Blue Train", "Kind of Blue"), page.albums.map { it.title })
        assertEquals(listOf(7L, 5L, 3L), AlbumPage.parse(client.getJson("/api/library/albums?sort=added&dir=desc")).albums.map { it.offset })
        assertEquals(listOf("Blue Train"), AlbumPage.parse(client.getJson("/api/library/albums?offset=1&count=1")).albums.map { it.title })
    }

    @Test fun `an album's page, the one saved or made from what the phone knows`() {
        val blue = lib.album(7)
        assertEquals("Blue Train", blue.album.title)
        assertEquals(1958, blue.album.year)
        val abbey = lib.album(3)
        assertEquals(listOf("Come Together", "Something"), abbey.tracks.map { it.title })
        assertEquals("al-3", abbey.album.imageKey)
        assertEquals(listOf("The Beatles"), abbey.artists)
        try { lib.album(99); fail("an album not on the phone") } catch (e: ServerClient.ServerException) {
            assertEquals(409, e.status); assertEquals("That album isn't on this phone", e.message)
        }
    }

    @Test fun `search and an artist's albums, by title or artist`() {
        assertEquals(listOf("Blue Train", "Kind of Blue"), lib.search("blue").albums.map { it.title })
        assertEquals(listOf("Abbey Road"), lib.search("BEATLES").albums.map { it.title })
        assertTrue(lib.search("  ").albums.isEmpty())
        assertEquals(listOf("Kind of Blue"), lib.artistAlbums("miles").primary.map { it.title })
    }

    @Test fun `Random Album picks one of the phone's, and says so when there is none`() {
        assertTrue(lib.pickUnheard().album.offset in setOf(3L, 5L, 7L))
        val empty = ServerClient(ServerAddress("phone", 0), transport = LocalTransport { _, p, q, _ -> PhoneShelf(emptyList()).get(p, q)!! })
        try { LibraryClient(empty).pickUnheard(); fail("nothing downloaded") } catch (e: ServerClient.ServerException) { assertEquals("Nothing downloaded to play", e.message) }
    }

    @Test fun `the rows the phone keeps nothing for are empty, as the server's with nothing to show`() {
        val unplayed = lib.unplayed(6, 30)
        assertTrue(unplayed.albums.isEmpty()); assertTrue(unplayed.noHistory)
        assertTrue(lib.recentlyPlayed().albums.isEmpty())
        assertTrue(lib.userPlaylists().isEmpty())
        assertEquals(2, lib.randomAlbums(2).albums.size)
    }

    @Test fun `the phone's own music, its badge as the server shapes it, and its page`() {
        val j = client.getJson("/api/phone-music/albums")
        val a = j.getJSONArray("albums").getJSONObject(0)
        assertEquals("phone:ab12", a.getString("offset"))
        assertEquals("24/96", a.getString("quality"))
        assertTrue(a.getBoolean("hires"))
        assertEquals("phone-ab12", a.getString("image_key"))
        assertEquals("Music", j.getString("folder"))
        val page = client.getJson("/api/album?offset=" + java.net.URLEncoder.encode("phone:ab12", "UTF-8"))
        assertTrue(page.getBoolean("on_phone"))
        assertEquals("1:01", page.getJSONArray("tracks").getJSONObject(0).getString("subtitle"))
        assertEquals("MP3", PhoneShelf.quality(PhoneAlbum("x", "", "", null, false, listOf(PhoneTrack("", "", 1.0, "mp3", 44100, 0)))))
        assertFalse(PhoneShelf.hires(PhoneAlbum("x", "", "", null, false, listOf(PhoneTrack("", "", 1.0, "flac", 44100, 16)))))
        assertEquals("16/44.1", PhoneShelf.quality(PhoneAlbum("x", "", "", null, false, listOf(PhoneTrack("", "", 1.0, "flac", 44100, 16)))))
    }

    @Test fun `the phone's own album as the album page reads it`() {
        val v = PhoneShelf.phoneView(PhoneAlbum("ab12", "Home Tapes", "Me", 2020, true, listOf(PhoneTrack("One", "Me", 61.0, "flac", 96000, 24), PhoneTrack("Two", "Me", 70.0, "flac", 96000, 24))))
        assertEquals("Home Tapes", v.album.title)
        assertEquals(-1L, v.album.offset)
        assertEquals("phone-ab12", v.album.imageKey)
        assertEquals("24/96", v.album.quality)
        assertEquals(listOf(-1L, -2L), v.tracks.map { it.id })
        assertEquals(listOf("play_now", "queue", "play_next", "shuffle"), v.actions.map { it.kind })
        assertEquals(listOf("Me"), v.artists)
    }

    @Test fun `every path it answers is listed, and only those`() {
        for (p in PhoneShelf.PATHS) assertTrue(p, shelf.get(p, mapOf("offset" to "7", "q" to "x", "artist" to "x")) != null)
        assertEquals(null, shelf.get("/api/zone-state", emptyMap()))
    }

    @Test fun `downloads as the library has them, each found or gone`() {
        val got = DownloadedAlbum.list(shelf.downloadAlbums(listOf(5, 8)).json!!)
        assertEquals("Kind of Blue", got[0].album?.title)
        assertEquals(null, got[1].album)
    }

    @Test fun `a query's fields decoded and the path kept apart`() {
        assertEquals(mapOf("q" to "a b c", "x" to ""), LocalTransport.query("q=a+b%20c&x"))
        var asked = ""
        ServerClient(ServerAddress("phone", 0), transport = LocalTransport { m, p, q, _ -> asked = "$m $p ${q["zone"]}"; Answer.ok(JSONObject()) }).getJson("/api/queue?zone=PHONE_1")
        assertEquals("GET /api/queue PHONE_1", asked)
    }
}
