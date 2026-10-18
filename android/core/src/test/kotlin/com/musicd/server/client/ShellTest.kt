package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ShellTest {
    @Test fun `the page's route carries its path there and back`() {
        for (p in listOf("/", "/album/42", "/search?q=a b&c=1", "/settings#setup")) {
            val route = ShellRoute.web(p)
            assertTrue(route, route.startsWith("web/") && route.indexOf('/', 4) < 0)
            assertEquals(p, ShellRoute.pagePath(route.removePrefix("web/")))
        }
        assertEquals("/", ShellRoute.pagePath(null))
        assertEquals("/", ShellRoute.pagePath(""))
        assertEquals("/album/1", ShellRoute.pagePath("album%2F1"))
        assertEquals(ShellRoute.web("/"), ShellRoute.web(""))
    }

    @Test fun `the page's route is the WebView's, any other the shell's`() {
        assertTrue(ShellRoute.isWeb(ShellRoute.WEB))
        assertTrue(ShellRoute.isWeb(ShellRoute.web("/album/1")))
        assertTrue("nothing yet: the page", ShellRoute.isWeb(null))
        assertFalse(ShellRoute.isWeb("nowplaying"))
    }

    // The native screens are drawn in the page's own graphite and brass: each
    // colour as style.css's dark "hifi" palette has it.
    @Test fun `the palette is the page's`() {
        val css = listOf("../../public/style.css", "../public/style.css", "public/style.css").map { File(it) }.first { it.exists() }.readText()
        val start = css.indexOf("[data-theme=\"dark\"][data-palette=\"hifi\"] {")
        assertTrue("the palette's block", start >= 0)
        val block = css.substring(start, css.indexOf("\n}", start))
        for ((name, argb) in Palette.tokens) {
            val m = Regex("--$name:\\s*#([0-9a-fA-F]{6});").find(block)
            assertTrue("--$name in the palette", m != null)
            assertEquals("--$name", 0xFF000000L or m!!.groupValues[1].toLong(16), argb)
        }
    }
}
