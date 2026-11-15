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
