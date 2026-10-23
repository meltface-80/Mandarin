package com.musicd.server.client

import com.musicd.server.client.SoloistSteps.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoloistStepsTest {
    private fun buttons(n: SoloistSteps.Next) = listOfNotNull("getReady".takeIf { n.getReady }, "start".takeIf { n.start }, "stop".takeIf { n.stop },
        "announce".takeIf { n.announce }, "play".takeIf { n.play })

    @Test fun `one step at a time, and only the buttons that can work`() {
        val ready = State(linuxRuns = true, downloaded = true, soloistRuns = true, hasKey = true)
        val steps = listOf(
            State() to ("Step 1 of 3 · Get ready" to listOf("getReady")),
            State(busy = "Downloading Soloist… 4096 KB") to ("Working…" to emptyList()),
            ready.copy(hasKey = false) to ("Step 2 of 3 · Your Soloist key" to listOf("getReady")),
            ready to ("Step 2 of 3 · Start" to listOf("getReady", "start")),
            ready.copy(running = true) to ("Starting…" to listOf("stop")),
            ready.copy(running = true, listening = true) to ("Step 3 of 3 · Choose “Mandarin phone” in the Spotify app" to listOf("stop", "announce")),
            ready.copy(running = true, listening = true, announced = true) to ("Step 3 of 3 · Choose “Mandarin phone” in the Spotify app" to listOf("stop")),
            ready.copy(running = true, listening = true, signedIn = true, connected = true) to ("Signed in · play something" to listOf("stop", "play")),
            ready.copy(running = true, signedIn = true, connected = true, playing = true) to ("Playing on this phone" to listOf("stop", "play")),
        )
        for ((s, want) in steps) {
            val n = SoloistSteps.next(s)
            assertEquals(s.toString(), want.first, n.heading)
            assertEquals(s.toString(), want.second, buttons(n))
        }
        assertFalse("Play and Announce never while Soloist isn't running", SoloistSteps.next(ready).play || SoloistSteps.next(ready).announce)
    }

    @Test fun `what went wrong said plainly, and how to send it`() {
        val failed = SoloistSteps.next(State(linuxRuns = true, downloaded = true, soloistRuns = false,
            readyFailed = "Soloist couldn't start: error while loading shared libraries: libpthread.so.0"))
        assertEquals("Getting ready didn't finish", failed.heading)
        assertTrue(failed.text.startsWith("Soloist couldn't start: error while loading shared libraries: libpthread.so.0"))
        assertTrue(failed.text.contains("Share report"))
        assertEquals(listOf("getReady"), buttons(failed))
        val stopped = SoloistSteps.next(State(linuxRuns = true, downloaded = true, soloistRuns = true, hasKey = true, stopped = "It ended (exit 1)."))
        assertEquals("Soloist stopped", stopped.heading)
        assertEquals(listOf("getReady", "start"), buttons(stopped))
        assertEquals("This app has no Soloist in it", SoloistSteps.next(State(inBuild = false)).heading)
    }

    @Test fun `the checklist marks what's done, what failed and what's still to come`() {
        fun marks(s: State) = SoloistSteps.checklist(s).map { it.text + " " + when (it.done) { true -> "✓"; false -> "✗"; null -> "·" } }
        assertEquals(listOf("Linux runs in the app ·", "Soloist downloaded ·", "Soloist runs on this phone ·", "Signed in to Spotify ·", "Playing ·", "Lossless ·"), marks(State()))
        assertEquals(listOf("Linux runs in the app ✓", "Soloist downloaded ✓", "Soloist runs on this phone ✗", "Signed in to Spotify ·", "Playing ·", "Lossless ·"),
            marks(State(linuxRuns = true, downloaded = true, soloistRuns = false, readyFailed = "x")))
        assertEquals(listOf("Linux runs in the app ✓", "Soloist downloaded ✓", "Soloist runs on this phone ✓", "Signed in to Spotify ✓", "Playing ✓", "Lossless (24-bit) ✓"),
            marks(State(linuxRuns = true, downloaded = true, soloistRuns = true, running = true, signedIn = true, playing = true, verdict = "lossless 24-bit")))
        assertEquals("Lossless — no, lossy ✗", marks(State(verdict = "lossy")).last())
    }
}
