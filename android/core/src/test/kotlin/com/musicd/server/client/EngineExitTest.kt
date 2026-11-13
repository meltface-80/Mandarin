package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The engine stopping itself, said in the app's log and left to rest until it is wanted (item 404). */
class EngineExitTest {
    private val cpuNote = """
        kind cpu
        why 39.0 s of CPU in the last 60 s, 65% of a core, with nothing passing through
        cpu 195.7
        busy in 10 of 10 looks: running tailscale.com/wgengine/magicsock.(*Conn).receiveIP
        busy 61 goroutines; most: 12 select tailscale.com/net/netcheck.(*Client).GetReport
        line 08:44:58 magicsock: disco: node [p46IL] now using 192.168.0.57:40107
        line 08:44:59 netcheck: report: udp=true v4a=81.2.69.160:51875
    """.trimIndent()

    @Test fun `its own stops are told from a crash or a kill`() {
        assertTrue(EngineExit.selfStop(EngineExit.IDLE))
        assertTrue(EngineExit.selfStop(EngineExit.CPU))
        for (code in listOf(0, 1, 2, 137, 143, -1)) assertFalse("exit $code", EngineExit.selfStop(code))
    }

    @Test fun `a CPU stop says what was busy and its last lines, each through the redactor`() {
        val n = EngineExit.parse(cpuNote)!!
        assertEquals("cpu", n.kind)
        assertEquals("195.7", n.cpu)
        assertEquals(2, n.busy.size)
        assertEquals(2, n.lines.size)
        val line = EngineExit.logLine(n) { LogRedact.line(it) }
        assertTrue(line, line.startsWith("the Tailscale engine stopped itself (CPU: 39.0 s of CPU in the last 60 s, 65% of a core, with nothing passing through): cpu 195.7 s; what was busy: in 10 of 10 looks: running tailscale.com/wgengine/magicsock.(*Conn).receiveIP | 61 goroutines"))
        assertTrue(line, line.contains("; its last lines: 08:44:58 magicsock: disco"))
        assertFalse("an internet address left in: $line", line.contains("81.2.69.160"))
    }

    @Test fun `an idle stop, and notes that aren't one or run long`() {
        val n = EngineExit.parse("kind idle\nwhy nothing but the app's background requests through it for 2m30s\ncpu 3.2\n")!!
        assertEquals("the Tailscale engine stopped itself (idle: nothing but the app's background requests through it for 2m30s): cpu 3.2 s", EngineExit.logLine(n) { it })
        assertNull(EngineExit.parse(""))
        assertNull(EngineExit.parse("panic: runtime error\ngoroutine 1 [running]:"))
        val long = EngineExit.parse("kind cpu\n" + (1..500).joinToString("\n") { "line " + "x".repeat(1000) })!!
        assertEquals(12, long.lines.size)
        assertEquals(400, long.lines[0].length)
    }

    @Test fun `once it stopped itself only a use starts it again, a look at the way doesn't`() {
        val rest = EngineRest()
        assertTrue("never stopped: as before", rest.mayStart(wanted = false))
        rest.ended(137)
        assertTrue("killed: started again as before", rest.mayStart(wanted = false))
        rest.ended(EngineExit.IDLE)
        assertFalse("resting: the long polls' retries don't bring it back", rest.mayStart(wanted = false))
        assertTrue("on screen or playing: back", rest.mayStart(wanted = true))
        rest.started()
        assertTrue(rest.mayStart(wanted = false))
        rest.ended(EngineExit.CPU)
        assertFalse(rest.mayStart(wanted = false))
    }

    @Test fun `wanted while on screen or playing, the lease outlasting a missed renewal`() {
        assertTrue(EngineRest.wanted(onScreen = true, playing = false))
        assertTrue(EngineRest.wanted(onScreen = false, playing = true))
        assertFalse(EngineRest.wanted(onScreen = false, playing = false))
        assertTrue(EngineRest.LEASE_S * 1000L > 2 * EngineRest.RENEW_MS)
    }
}
