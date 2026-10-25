package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * This phone as the one room offline, and the app's answers for the server (item 107), read by the app's own client
 * over a [LocalTransport] so every answer is one the native screens read.
 */
class PhoneRoomTest {
    /** A player that keeps what it was told. */
    private class FakeDeck(var st: DeckState? = null, var starts: Boolean = true) : Deck {
        val plays = ArrayList<String>()
        val commands = ArrayList<Phone.Command>()
        var waited: Pair<Long, Long>? = null
        override fun ready() = starts
        override fun state() = st
        override fun revision() = st?.revision ?: 1
        override fun waitForChange(since: Long, ms: Long) { waited = since to ms }
        override fun play(albumIds: List<Int>, start: Int, kind: String, only: Int?): Boolean {
            plays += "$albumIds $start $kind $only"; return albumIds.all { it in setOf(3, 7) }
        }
        override fun command(c: Phone.Command) { commands += c }
    }

    private val shelf = PhoneShelf(listOf(
        ShelfAlbum(7, "Blue Train", "John Coltrane", 1958, "al-7", 300, emptyList()),
        ShelfAlbum(3, "Abbey Road", "The Beatles", 1969, null, 100, emptyList()),
    ), PhoneMusic(listOf(PhoneAlbum("ab12", "Home Tapes", "Me", 2020, false, emptyList()))))
    private val playing = DeckState("playing", 1, 42.0, 200.0, false, "disabled", 60, false, listOf(
        DeckItem(1, 7, "Blue Train", "John Coltrane", "Blue Train", "al-7", 643.0),
        DeckItem(2, 3, "Come Together", "The Beatles", "Abbey Road", null, 259.0),
        DeckItem(null, -1, "One", "Me", "Home Tapes", null, 61.0, albumKey = "ab12"),
    ), 9, format = "lossless", dsp = true)
    private val deck = FakeDeck(playing)
    private val answers = PhoneAnswers({ PhoneInfo("1.0.17", "owner", true) }, { shelf }, PhoneRoom("PHONE_1", deck) { shelf }, { shelf.all() },
        cached = { p -> if (p == "/api/settings/home-rows") JSONObject("""{"rows":[]}""") else null })
    private val client = ServerClient(ServerAddress("phone", 0), transport = LocalTransport(answers::answer))

    @Test fun `the one room is this phone, playing what its player plays`() {
        assertEquals(listOf("This phone"), client.rooms().map { it.name })
        assertEquals("PHONE_1", client.zones().lastZone)
        val z = client.zoneState("PHONE_1", waitFor = 9).zone!!
        // Held as long as asked (the server's 20 s), as the server holds it (item 120: held 1.5 s, a screen's room was
        // asked for 40 times a minute offline).
        assertEquals(9L to 20_000L, deck.waited)
        assertEquals("Come Together", z.nowPlaying?.title)
        assertEquals("3", z.nowPlaying?.albumId)
        assertEquals("Lossless · DSP", z.nowPlaying?.format?.text)
        assertEquals(60, z.volume)
        assertTrue(z.nextAllowed); assertTrue(z.previousAllowed)
        assertTrue(client.outputs().isEmpty())
    }

    @Test fun `its queue, what is still to come and what has played`() {
        val q = client.queue("PHONE_1")
        assertEquals(listOf("Come Together", "One"), q.items.map { it.title })
        assertEquals(listOf("Blue Train"), q.history.map { it.track })
    }

    @Test fun `what plays now, a download or one of the phone's own`() {
        assertEquals("Abbey Road", client.getJson("/api/album/now-playing").getJSONObject("album").getString("title"))
        deck.st = playing.copy(index = 2)
        assertEquals("phone:ab12", client.getJson("/api/album/now-playing").getJSONObject("album").getString("offset"))
        deck.st = null
        assertTrue(client.getJson("/api/album/now-playing").isNull("album"))
    }

    @Test fun `an album, a track and a selection sent to the phone's player`() {
        assertEquals("play_now", client.playAlbum(7, "Blue Train", "John Coltrane", "PHONE_1", "play_now").getString("action"))
        client.playTrack(3, 1, "Something", "Abbey Road", "The Beatles", "PHONE_1", "play_next")
        client.playAlbum(3, "", "", "PHONE_1", "shuffle")
        // Shuffle (item 194): the deck plays it shuffled; the player's own shuffle is left as it was, not switched on.
        assertEquals(listOf("[7] 0 play_now null", "[3] 0 add_next 1", "[3] 0 shuffle null"), deck.plays)
        assertTrue(deck.commands.none { it.op == "mode" })
        val multi = client.playMulti(listOf(summary(7), summary(5)), "PHONE_1", "queue")
        assertEquals(1, multi.getInt("queued")); assertEquals(1, multi.getInt("failed"))
        try { client.playAlbum(5, "", "", "PHONE_1", "play_now"); fail("not on the phone") } catch (e: ServerClient.ServerException) { assertEquals(404, e.status) }
    }

    @Test fun `transport, seek, volume and repeat to the phone's player`() {
        client.control("PHONE_1", "playpause")
        client.seek("PHONE_1", 30.0)
        client.zoneVolume("PHONE_1", 140.0)
        client.zoneSettings("PHONE_1", loop = "loop")
        client.playFromHere("PHONE_1", 2)
        assertEquals(listOf("pause", "seek", "volume", "mode", "jump"), deck.commands.map { it.op })
        assertEquals(100, deck.commands[2].value)
        assertEquals("loop", deck.commands[3].loop)
        assertEquals(1, deck.commands[4].index)
        deck.starts = false
        try { client.control("PHONE_1", "next"); fail("no player") } catch (e: ServerClient.ServerException) { assertEquals(PhoneRoom.NOT_STARTED, e.message) }
    }

    @Test fun `the server's own, the library's, a setting as last given, and what needs the server`() {
        val status = client.getJson("/api/status")
        assertTrue(status.getBoolean("offline")); assertTrue(status.getBoolean("offline_mode")); assertEquals(2, status.getInt("index_count"))
        assertEquals("owner", client.getJson("/api/auth/status").getString("username"))
        assertEquals(2, LibraryClient(client).albums().total)
        assertTrue(LibraryClient(client).homeRows().isEmpty())
        assertFalse(client.getJson("/api/settings/waveform").has("enabled"))
        try { client.post("/api/favourites", JSONObject()); fail("needs the server") } catch (e: ServerClient.ServerException) {
            assertEquals(503, e.status); assertEquals(PhoneAnswers.OFFLINE, e.message)
        }
    }

    private fun summary(offset: Long) = AlbumSummary.parse(JSONObject().put("offset", offset).put("title", "t").put("subtitle", "s"))
}
