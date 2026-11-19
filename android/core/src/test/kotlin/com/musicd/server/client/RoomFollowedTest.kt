package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which room a screen follows, and the wait for the server when the app comes back on screen (bug list item 485: Now
 * playing in a server's room showed the phone's own queue, a song of hours before, after the Wi-Fi had dropped for a
 * moment off screen).
 */
class RoomFollowedTest {
    private val bridge = "SLIM_1"
    private val phone = "PHONE_1"

    @Test fun `online a screen follows its own room`() {
        assertEquals(Followed(bridge, true), RoomFollowed.of(bridge, offline = false, looking = false, away = false, phone = phone))
        assertEquals(Followed(phone, true), RoomFollowed.of(phone, offline = false, looking = false, away = false, phone = phone))
        // Whatever was being waited for when it came back.
        assertEquals(Followed(bridge, true), RoomFollowed.of(bridge, offline = false, looking = true, away = false, phone = phone))
    }

    @Test fun `offline the phone is the one room, and a screen follows it`() {
        assertEquals(Followed(phone, true), RoomFollowed.of(bridge, offline = true, looking = false, away = false, phone = phone))
        assertEquals(Followed(phone, true), RoomFollowed.of(phone, offline = true, looking = false, away = false, phone = phone))
    }

    @Test fun `while the server is looked for, a screen keeps its room as last answered and asks no one`() {
        assertEquals(Followed(bridge, false), RoomFollowed.of(bridge, offline = true, looking = true, away = false, phone = phone))
        // The phone's own room is the phone's to answer all the while.
        assertEquals(Followed(phone, true), RoomFollowed.of(phone, offline = true, looking = true, away = false, phone = phone))
    }

    @Test fun `a screen with no room follows none`() {
        for (offline in listOf(false, true)) for (looking in listOf(false, true)) for (away in listOf(false, true))
            assertEquals(Followed("", false), RoomFollowed.of("", offline, looking, away, phone))
    }

    /** Item 487: opened at home in the Bridge's room, Now playing went on asking for the Bridge's from away, and was refused. */
    @Test fun `away with the server answering, a screen follows the phone's room, and its own again at home`() {
        assertEquals(Followed(phone, true), RoomFollowed.of(bridge, offline = false, looking = false, away = true, phone = phone))
        assertEquals(Followed(phone, true), RoomFollowed.of(phone, offline = false, looking = false, away = true, phone = phone))
        assertEquals(Followed(bridge, true), RoomFollowed.of(bridge, offline = false, looking = false, away = false, phone = phone))
    }

    @Test fun `away and offline are as offline, the phone's room once the look has answered`() {
        assertEquals(Followed(bridge, false), RoomFollowed.of(bridge, offline = true, looking = true, away = true, phone = phone))
        assertEquals(Followed(phone, true), RoomFollowed.of(bridge, offline = true, looking = false, away = true, phone = phone))
    }

    @Test fun `the phone's room not yet known, a screen keeps its own`() {
        assertEquals(Followed(bridge, true), RoomFollowed.of(bridge, offline = false, looking = false, away = true, phone = ""))
    }

    @Test fun `the wait is shorter away than at home`() {
        assertEquals(3_000L, LookWait.mostMs(away = true))
        assertEquals(6_000L, LookWait.mostMs(away = false))
    }

    @Test fun `the wait lasts until the look answers`() {
        val w = LookWait()
        assertFalse(w.waiting)
        w.begin(); val look = w.asked()
        assertTrue(w.waiting)
        w.answered(look, back = false)
        assertFalse(w.waiting)
        w.begin(); w.answered(w.asked(), back = true)
        assertFalse(w.waiting)
    }

    /** The Wi-Fi comes back a moment after the screen: the look begun on the old way fails, the one asked for since finds the server. */
    @Test fun `a look overtaken by a later one doesn't end the wait by failing`() {
        val w = LookWait()
        w.begin()
        val first = w.asked()
        val second = w.asked()
        w.answered(first, back = false)
        assertTrue(w.waiting)
        w.answered(second, back = false)
        assertFalse(w.waiting)
        // Found by the earlier look, the wait is over at once.
        w.begin(); val a = w.asked(); w.asked()
        w.answered(a, back = true)
        assertFalse(w.waiting)
    }

    @Test fun `no look to wait for ends it, and a look asked for alone starts none`() {
        val w = LookWait()
        w.begin(); w.asked(); w.end()
        assertFalse(w.waiting)
        w.asked()
        assertFalse(w.waiting)
    }
}
