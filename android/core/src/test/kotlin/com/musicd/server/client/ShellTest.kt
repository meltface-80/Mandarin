package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ShellTest {
    @Test fun `one screen gives way to the next at once, with no fade between them`() {
        // Navigation's default cross-fade (700 ms) showed the screen left as a ghost over the one coming (bug list item 72).
        val src = File("../app/src/main/java/com/musicd/server/android/NativeShell.kt").readText()
        val host = src.substring(src.indexOf("NavHost(")).substringBefore(") {")
        for (t in listOf("enterTransition = { androidx.compose.animation.EnterTransition.None }", "exitTransition = { androidx.compose.animation.ExitTransition.None }",
            "popEnterTransition = { androidx.compose.animation.EnterTransition.None }", "popExitTransition = { androidx.compose.animation.ExitTransition.None }"))
            assertTrue(t, host.contains(t))
    }

    @Test fun `no route is the page's any more`() {
        // The shell starts on Home (item 111): the page's route, and the WebView under it, are gone.
        assertTrue(ShellRoute::class.java.declaredFields.none { it.name == "WEB" || it.name == "PATH" })
        val src = File("../app/src/main/java/com/musicd/server/android/NativeShell.kt").readText()
        assertTrue(src.contains("startDestination = ShellRoute.HOME"))
    }

    @Test fun `an album's route carries its offset and its room`() {
        assertEquals("album/42?zone=RINCON_X%20Y&lit=&nav=&at=-1", ShellRoute.album(42, "RINCON_X Y"))
        assertEquals("the page's button lit under it, and the list it came from", "album/42?zone=z&lit=home&nav=l1&at=2", ShellRoute.album(42, "z", "home", "l1", 2))
        assertEquals("album/{offset}?zone={zone}&lit={lit}&nav={nav}&at={at}", ShellRoute.ALBUM)
        assertEquals("booklet/42/b%201?name=Inlay%20%28scan%29&pages=3", ShellRoute.booklet(42, "b 1", "Inlay (scan)", 3))
        // A wall's route carries its filter (a genre's wall, item 57), Home the page's settings and room, Smart Picks the room.
        assertEquals("wall/genre?zone=z&filter=%26filter_type%3Dgenre%26filter_value%3DRock", ShellRoute.wall("genre", "z", "&filter_type=genre&filter_value=Rock"))
        assertEquals("wall/random?zone=z&filter=", ShellRoute.wall("random", "z"))
        assertEquals("home?prefs=%7B%7D&zone=z%201", ShellRoute.home("{}", "z 1"))
        assertEquals("picks?zone=z", ShellRoute.picks("z"))
    }

    // The native screens are drawn in the page's own graphite and brass: each
    // colour as style.css's dark "hifi" palette has it.
    /**
     * Every route of the shell's has a screen in the app's graph (NativeShell.kt): a route built and navigated to with
     * no destination for it brings the app down (bug list item 59: the booklet's, never declared, crashed the app on
     * every booklet tapped). Read from the source, as the app itself only compiles in CI.
     */
    @Test fun `every route of the shell's has a screen in the app's graph`() {
        // The graph is NativeShell.kt's, the later routes in ShellRoutes.kt (item 65).
        val src = listOf("NativeShell.kt", "ShellRoutes.kt").joinToString("\n") { f ->
            listOf("../app/src/main/java/com/musicd/server/android/$f", "../../android/app/src/main/java/com/musicd/server/android/$f",
                "android/app/src/main/java/com/musicd/server/android/$f").map { java.io.File(it) }.first { it.exists() }.readText()
        }
        val routes = ShellRoute::class.java.declaredFields.filter { it.type == String::class.java && java.lang.reflect.Modifier.isStatic(it.modifiers) }
            .map { it.name to (it.also { f -> f.isAccessible = true }.get(null) as String) }
            .filter { (_, v) -> v.contains("{") }   // a route pattern names its arguments; the rest are argument names
        assertTrue(routes.map { it.first }.containsAll(listOf("HOME", "NOW_PLAYING", "ALBUM", "LIBRARY", "WALL", "ARTIST", "BOOKLET")))
        for ((name, _) in routes) assertTrue("ShellRoute.$name has no composable(ShellRoute.$name …) in NativeShell.kt or ShellRoutes.kt", Regex("composable\\(\\s*ShellRoute\\.$name\\b").containsMatchIn(src))
    }

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
