package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cache an artist's page is drawn from when opened again (bug list item 140). */
class TimedCacheTest {
    @Test
    fun keptForItsTimeThenStaleButStillThere() {
        var t = 1_000L
        val c = TimedCache<String, String>(capacity = 4, ttlMs = 600_000) { t }
        c.put("Iron Maiden", "page")
        assertEquals("page", c.get("Iron Maiden"))
        assertTrue(c.fresh("Iron Maiden"))
        t += 600_000
        assertFalse("fetched afresh after ten minutes", c.fresh("Iron Maiden"))
        assertEquals("drawn from what was kept meanwhile", "page", c.get("Iron Maiden"))
        assertFalse(c.fresh("Somebody"))
    }

    @Test
    fun theLeastRecentlyUsedGoesFirst() {
        val c = TimedCache<String, Int>(capacity = 2, ttlMs = 1_000) { 0 }
        c.put("a", 1); c.put("b", 2)
        c.get("a")
        c.put("c", 3)
        assertNull("b, the least recently used, let go", c.get("b"))
        assertEquals(1, c.get("a")); assertEquals(3, c.get("c"))
    }

    @Test
    fun anUpdateKeepsItsTime() {
        var t = 0L
        val c = TimedCache<String, List<String>>(capacity = 2, ttlMs = 100) { t }
        c.update("x", emptyList()) { it + "about" }
        t = 60
        c.update("x", emptyList()) { it + "bio" }
        assertEquals(listOf("about", "bio"), c.get("x"))
        t = 100
        assertFalse("its time from when it was first put", c.fresh("x"))
    }

    @Test fun `cleared, nothing is kept`() {
        val c = TimedCache<String, Int>(capacity = 4, ttlMs = 60_000, now = { 0L })
        c.put("a", 1); c.put("b", 2)
        c.clear()
        assertNull(c.get("a")); assertFalse(c.fresh("b"))
    }
}

