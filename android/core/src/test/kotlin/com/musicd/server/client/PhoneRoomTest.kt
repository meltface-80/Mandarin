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
        var asked = 0
        override fun ready(): Boolean { asked++; return starts }
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
        DeckItem(null, -1, "One", "Me", "Home Tapes", null, 61.0, albumKey = "ab12", albumTrack = 2),
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
        // One of the phone's own: its place on its album, as the album page numbers its tracks (-1, -2, …), so it is marked playing (item 541).
        assertEquals(-3L, client.zoneState("PHONE_1").zone!!.nowPlaying?.trackId)
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

    /** Item 485: the phone told Now playing in a server's room what its own player held, a song of hours before. */
    @Test fun `another room's state isn't the phone's to give`() {
        try { client.zoneState("SLIM_1"); fail("the phone answered for a room of the server's") } catch (e: ServerClient.ServerException) { assertEquals(404, e.status) }
        try { client.zoneState("SLIM_1", waitFor = 9); fail("held for a room of the server's") } catch (e: ServerClient.ServerException) { assertEquals(404, e.status) }
        // Nor is its player started, or held, to answer it.
        assertEquals(0, deck.asked); assertEquals(null, deck.waited)
        assertEquals("Come Together", client.zoneState("PHONE_1").zone?.nowPlaying?.title)
    }

    /**
     * Item 485: back on screen and the server still looked for, what a screen in a server's room sends isn't taken by
     * the phone's player (a tap on play would have started the phone's own queue); offline for sure, it is, as before.
     */
    @Test fun `while the server is looked for, another room's requests aren't the phone's to take`() {
        var held = true
        val waiting = ServerClient(ServerAddress("phone", 0), transport = LocalTransport(PhoneAnswers({ PhoneInfo("1.0.17", "owner", true) }, { shelf },
            PhoneRoom("PHONE_1", deck, held = { held }) { shelf }, { shelf.all() })::answer))
        val asks = listOf<Pair<String, () -> Any>>(
            "control" to { waiting.control("SLIM_1", "playpause") }, "seek" to { waiting.seek("SLIM_1", 30.0) },
            "volume" to { waiting.zoneVolume("SLIM_1", 40.0) }, "repeat" to { waiting.zoneSettings("SLIM_1", loop = "loop") },
            "from here" to { waiting.playFromHere("SLIM_1", 2) }, "the queue" to { waiting.queue("SLIM_1") },
            "an album" to { waiting.playAlbum(7, "Blue Train", "John Coltrane", "SLIM_1", "play_now") },
            "a track" to { waiting.playTrack(3, 1, "Something", "Abbey Road", "The Beatles", "SLIM_1", "play_next") },
            "a selection" to { waiting.playMulti(listOf(summary(7)), "SLIM_1", "queue") })
        for ((what, ask) in asks) {
            try { ask(); fail("$what was taken by the phone") } catch (e: ServerClient.ServerException) { assertEquals(what, 503, e.status); assertEquals(what, PhoneRoom.LOOKING, e.message) }
        }
        assertTrue(deck.commands.isEmpty()); assertTrue(deck.plays.isEmpty()); assertEquals(0, deck.asked)
        // The phone's own room is the phone's still.
        waiting.control("PHONE_1", "playpause")
        assertEquals(listOf("pause"), deck.commands.map { it.op })
        // The server not found: the phone is the one room, and takes what any screen sends (item 117: the screen on show stays).
        held = false
        for ((_, ask) in asks) ask()
        assertEquals(listOf("pause", "pause", "seek", "volume", "mode", "jump"), deck.commands.map { it.op })
        assertEquals(3, deck.plays.size)
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
