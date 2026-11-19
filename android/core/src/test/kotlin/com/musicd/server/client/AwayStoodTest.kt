package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Away acted on by the screens only once it has stood (bug list item 487): at home the app is "away" for a moment each
 * time the Wi-Fi has slept, and a screen that followed the phone's room at once would show the phone's queue for it.
 */
class AwayStoodTest {
    @Test fun `away counts once it has stood three seconds on screen`() {
        val a = AwayStood()
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 10_000))
        assertFalse(a.stood)
        assertEquals(1_000L, a.at(away = true, onScreen = true, now = 12_000))
        assertFalse(a.stood)
        assertEquals(null, a.at(away = true, onScreen = true, now = 13_000))
        assertTrue(a.stood)
    }

    /** The owner's phone on 19 November: on screen at 00:20:29 "away over MusicD's Tailscale", on the Wi-Fi at 00:20:31. */
    @Test fun `the Wi-Fi back a moment after the screen, away never counted`() {
        val a = AwayStood()
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 0))
        assertEquals(null, a.at(away = false, onScreen = true, now = 1_500))
        assertFalse(a.stood)
        // And the count starts from nothing the next time.
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 2_000))
        assertFalse(a.stood)
    }

    @Test fun `off screen nothing is counted, and the count starts again with the screen`() {
        val a = AwayStood()
        assertEquals(null, a.at(away = true, onScreen = false, now = 0))
        assertEquals(null, a.at(away = true, onScreen = false, now = 60_000))
        assertFalse(a.stood)
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 60_000))
        assertEquals(1_000L, a.at(away = true, onScreen = true, now = 62_000))
        // The screen off at two seconds, and on again: three more.
        assertEquals(null, a.at(away = true, onScreen = false, now = 62_500))
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 70_000))
        assertFalse(a.stood)
    }

    @Test fun `once stood, away stays so through the screen's going and coming, until home`() {
        val a = AwayStood()
        a.at(away = true, onScreen = true, now = 0)
        a.at(away = true, onScreen = true, now = 3_000)
        assertTrue(a.stood)
        assertEquals(null, a.at(away = true, onScreen = false, now = 4_000))
        assertTrue(a.stood)
        // On screen an hour later, still away: at once.
        assertEquals(null, a.at(away = true, onScreen = true, now = 3_600_000))
        assertTrue(a.stood)
        assertEquals(null, a.at(away = false, onScreen = true, now = 3_700_000))
        assertFalse(a.stood)
        assertEquals(3_000L, a.at(away = true, onScreen = true, now = 3_800_000))
        assertFalse(a.stood)
    }

    @Test fun `asked late, it has stood`() {
        val a = AwayStood()
        a.at(away = true, onScreen = true, now = 0)
        assertEquals(null, a.at(away = true, onScreen = true, now = 9_000))
        assertTrue(a.stood)
    }
}
