package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerIdleTest {
    private var now = 0L
    private val idle = PlayerIdle { now }
    private fun at(min: Double, playing: Boolean = false, onScreen: Boolean = false): Boolean {
        now = (min * 60_000).toLong()
        return idle.stop(playing, onScreen)
    }

    @Test fun pausedOffScreenStopsAfterFiveMinutesBeforeAndroidFreezesIt() {
        // Item 124: paused at 16:58, Media3 let the service go at 17:08, Android froze the app and ended it at 17:16.
        assertFalse(at(0.0, playing = true))
        assertFalse(at(1.0))
        assertFalse(at(5.9))
        assertTrue(at(6.0))
        assertTrue(PlayerIdle.STOP_MS < 10 * 60_000L)
    }

    @Test fun neverWhilePlaying() {
        assertEquals(listOf(false, false, false), listOf(0.0, 30.0, 600.0).map { at(it, playing = true) })
    }

    @Test fun notWhileOnScreenButAtOnceWhenLeftIfPausedLongEnough() {
        // Paused on the screen for nine minutes: Media3 lets go at ten, so it stops as soon as the app is left.
        assertFalse(at(0.0, onScreen = true))
        assertFalse(at(9.0, onScreen = true))
        assertTrue(at(9.1))
    }

    @Test fun playingAgainStartsTheCountAfresh() {
        assertFalse(at(0.0))
        assertFalse(at(4.0))
        assertFalse(at(4.5, playing = true))
        assertFalse(at(5.0))
        assertFalse(at(9.9))
        assertTrue(at(10.0))
    }

    @Test fun saidOnceThenNotAgainForFiveMinutes() {
        // A car still bound to the service keeps it alive: no stop asked for (and logged) every ten seconds.
        assertFalse(at(0.0))
        assertTrue(at(5.0))
        assertFalse(at(5.2))
        assertFalse(at(9.9))
        assertTrue(at(10.0))
    }
}
