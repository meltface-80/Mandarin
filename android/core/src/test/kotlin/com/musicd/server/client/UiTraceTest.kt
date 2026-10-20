package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The log build's watch on the screens (item 116): what a smooth app never shows. */
class UiTraceTest {
    @Test fun `a screen seen for a moment between two others is a flash`() {
        val t = UiTrace()
        assertEquals(emptyList<UiTrace.Finding>(), t.shown("home", 0))
        assertEquals(emptyList<UiTrace.Finding>(), t.shown("home+menu", 1_000))
        assertEquals(emptyList<UiTrace.Finding>(), t.shown("home", 2_000))
        assertEquals(listOf(UiTrace.Finding(2_016, "FLASH: home shown for 16 ms between home+menu and settings")), t.shown("settings", 2_016))
    }

    @Test fun `straight from the side menu to Settings is no flash, nor a screen kept a while`() {
        val t = UiTrace()
        t.shown("home", 0); t.shown("home+menu", 500)
        assertEquals(emptyList<UiTrace.Finding>(), t.shown("settings", 900))
        assertEquals(emptyList<UiTrace.Finding>(), t.shown("home", 5_000))
    }

    @Test fun `gone to and straight back is a bounce`() {
        val t = UiTrace()
        t.shown("settings", 0); t.shown("home", 1_000)
        assertEquals(listOf(UiTrace.Finding(1_050, "BOUNCE: home for 50 ms, then back to settings")), t.shown("settings", 1_050))
    }

    @Test fun `a back stack without Home at its foot, empty, or a screen twice in a row`() {
        val t = UiTrace()
        val home = ShellRoute.HOME
        assertEquals(emptyList<UiTrace.Finding>(), t.stack(listOf(home, ShellRoute.SETTINGS), 0))
        assertEquals("STACK: no screen at all", t.stack(emptyList(), 0).single().text)
        assertTrue(t.stack(listOf(ShellRoute.SETTINGS), 0).single().text.startsWith("STACK: Home not at the foot"))
        assertTrue(t.stack(listOf(home, ShellRoute.SETTINGS, ShellRoute.SETTINGS), 0).single().text.startsWith("STACK: ${ShellRoute.SETTINGS} twice in a row"))
    }

    @Test fun `a stall is a finding, slow frames a count by screen`() {
        val t = UiTrace()
        t.shown("home", 0)
        assertNull(t.frame(16, 10))
        assertNull(t.frame(40, 20))
        assertNull(t.frame(50, 30))
        assertEquals("JANK: a frame took 250 ms on home", t.frame(250, 40)!!.text)
        t.shown("library", 50)
        assertNull(t.frame(60, 60))
        assertEquals(mapOf("home" to 2, "library" to 1), t.slowFrames())
        assertEquals(emptyMap<String, Int>(), t.slowFrames())
    }
}
