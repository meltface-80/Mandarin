package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test

/** The Tailscale engine kept away and while the phone plays, stopped once idle at home (item 202). */
class EngineIdleTest {
    private var now = 1_000_000L
    private val idle = EngineIdle { now }

    @Test fun `away it is kept, however long, and the grace starts over`() {
        assertEquals(EngineIdle.Verdict.KEEP, idle.verdict(away = true, inUse = false))
        now += 60 * 60_000L
        assertEquals(EngineIdle.Verdict.KEEP, idle.verdict(away = true, inUse = false))
        assertEquals(EngineIdle.GRACE_MS, idle.remaining())
    }

    @Test fun `at home and idle it waits the grace, then stops`() {
        assertEquals(EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        now += EngineIdle.GRACE_MS - 1
        assertEquals(EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        assertEquals(1L, idle.remaining())
        now += 1
        assertEquals(EngineIdle.Verdict.STOP, idle.verdict(away = false, inUse = false))
        assertEquals(0L, idle.remaining())
    }

    @Test fun `the phone playing at home keeps it, and playing again starts the grace over`() {
        assertEquals(EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        now += EngineIdle.GRACE_MS - 10_000
        assertEquals(EngineIdle.Verdict.KEEP, idle.verdict(away = false, inUse = true))
        now += 20_000
        assertEquals("idle again only from now", EngineIdle.Verdict.WAIT, idle.verdict(away = false, inUse = false))
        assertEquals(EngineIdle.GRACE_MS, idle.remaining())
    }
}
