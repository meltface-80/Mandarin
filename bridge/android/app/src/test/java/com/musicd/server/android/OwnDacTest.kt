package com.musicd.server.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** This device's own DAC (item 432): which devices play through it by themselves, what it is called, what it takes. */
class OwnDacTest {
    @Test fun musicPlayersByTheirMaker() {
        assertTrue("a FiiO R7", OwnDac.isPlayer("FiiO", "R7"))
        assertTrue("a HiBy", OwnDac.isPlayer("HiBy", "R6 Pro II"))
        assertTrue("an iBasso", OwnDac.isPlayer("iBasso", "DX320"))
        assertTrue("a Shanling", OwnDac.isPlayer("SHANLING", "M7"))
        assertTrue("an Astell&Kern", OwnDac.isPlayer("Astell&Kern", "SP3000"))
        assertTrue("a Walkman", OwnDac.isPlayer("Sony", "NW-ZX707"))
        // A FiiO R7 says its maker is its chip's (item 433): known by its model, or its brand.
        assertTrue("a FiiO R7 saying QUALCOMM", OwnDac.isPlayer("QUALCOMM", "FiiO R7"))
        assertTrue("its brand FiiO", OwnDac.isPlayer("QUALCOMM", "R7", "FiiO"))
    }

    @Test fun phonesAreNot() {
        assertFalse("a Pixel", OwnDac.isPlayer("Google", "Pixel 8"))
        assertFalse("a Galaxy", OwnDac.isPlayer("samsung", "SM-S918B"))
        assertFalse("an Xperia: Sony, but not a Walkman", OwnDac.isPlayer("Sony", "XQ-DQ72"))
        assertFalse("nothing said", OwnDac.isPlayer("", ""))
    }

    @Test fun itsName() {
        assertEquals("FiiO R7", OwnDac.nameOf("FiiO", "R7"))
        assertEquals("the model already names its maker", "HiBy R6 Pro II", OwnDac.nameOf("HiBy", "HiBy R6 Pro II"))
        assertEquals("R7", OwnDac.nameOf("", "R7"))
        assertEquals("FiiO", OwnDac.nameOf("FiiO", ""))
        assertEquals("This device", OwnDac.nameOf("", ""))
        // The chip's maker is never its name (item 433).
        assertEquals("FiiO R7", OwnDac.nameOf("QUALCOMM", "FiiO R7"))
        assertEquals("FiiO R7", OwnDac.nameOf("QUALCOMM", "R7", "FiiO"))
        assertEquals("R7", OwnDac.nameOf("QUALCOMM", "R7"))
    }

    /** Taking a rate isn't playing at it (item 433): what Mandarin is told, by whether the output follows. */
    @Test fun whatMandarinIsToldToSend() {
        val taken = listOf(44100, 48000, 96000, 192000, 384000)
        assertFalse("an R7: asked 96 kHz, ran at 44.1", OwnDac.followed(96000, 44100))
        assertTrue(OwnDac.followed(96000, 96000))
        assertEquals("stays at 44.1: that rate alone, Mandarin converting", listOf(44100), OwnDac.advertised(taken, false, 44100))
        assertEquals("follows: every rate taken", taken, OwnDac.advertised(taken, true, 96000))
        assertEquals("not known yet: every rate taken", taken, OwnDac.advertised(taken, null, 0))
        assertEquals("didn't follow, its rate unsaid: every rate taken", taken, OwnDac.advertised(taken, false, 0))
    }

    @Test fun ratesInKhz() {
        assertEquals("44.1", OwnDac.khz(44100))
        assertEquals("192", OwnDac.khz(192000))
        assertEquals("352.8", OwnDac.khz(352800))
    }

    @Test fun theRatesAndroidTakes() {
        val all = listOf(44100, 48000, 96000, 192000, 384000)
        // Android 10: up to 192 kHz; a rate it throws on is one it doesn't take.
        assertEquals(listOf(44100, 48000, 96000, 192000), OwnDac.ratesTaken(all) { it <= 192000 })
        assertEquals(listOf(44100), OwnDac.ratesTaken(all) { if (it == 48000) throw IllegalArgumentException("no") else it == 44100 })
    }
}
