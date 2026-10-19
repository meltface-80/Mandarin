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

    @Test fun `an album's route carries its offset and its room`() {
        assertEquals("album/42?zone=RINCON_X%20Y", ShellRoute.album(42, "RINCON_X Y"))
        assertEquals("album/{offset}?zone={zone}", ShellRoute.ALBUM)
        assertFalse("the shell's, not the page's", ShellRoute.isWeb(ShellRoute.album(1, "")))
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
        // The translucent ones: rgba(r,g,b,a), the alpha to the nearest of 255.
        for ((name, argb) in Palette.rgbaTokens) {
            val m = Regex("--$name:\\s*rgba\\((\\d+),(\\d+),(\\d+),(\\.?\\d+)\\);").find(block)
            assertTrue("--$name in the palette", m != null)
            val (r, g, b, a) = m!!.destructured
            val want = (Math.round(a.toDouble() * 255).toLong() shl 24) or (r.toLong() shl 16) or (g.toLong() shl 8) or b.toLong()
            assertEquals("--$name", want, argb)
        }
    }
}
