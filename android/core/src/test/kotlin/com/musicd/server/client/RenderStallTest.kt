package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A freeze in the screen's drawing, said (item 471): what Android's drawing thread was doing, and where the app was. */
class RenderStallTest {
    @Test fun `its state read from its stat line, a name with spaces and brackets in it read past`() {
        assertEquals('S', RenderStall.state("4321 (RenderThread) S 1234 1234 0 0 -1"))
        assertEquals('D', RenderStall.state("4321 (odd (name) here) D 1 2"))
        assertNull(RenderStall.state(null))
        assertNull(RenderStall.state("garbage"))
    }

    @Test fun `said as waiting on the graphics driver, in its ioctl, where the kernel tells it`() {
        assertEquals("the drawing thread (RenderThread): waiting on a device, and can't be woken (the graphics driver, most likely), " +
            "in the kernel at dma_fence_default_wait, in ioctl (a driver: the graphics chip's, as a drawing thread's are)",
            RenderStall.describe("9 (RenderThread) D 1", "dma_fence_default_wait\n", "29 0x5 0x0"))
        assertEquals("the drawing thread (RenderThread): running (drawing, busy)", RenderStall.describe("9 (RenderThread) R 1", "0", "-1 0x0"))
        assertEquals("the drawing thread (RenderThread): waiting, in futex (a lock)", RenderStall.describe("9 (RenderThread) S 1", null, "98 0x1"))
        assertEquals("the drawing thread (RenderThread): waiting, in system call 999", RenderStall.describe("9 (RenderThread) S 1", "", "999"))
        assertEquals("the drawing thread (RenderThread): not found", RenderStall.describe(null, null, null))
    }

    @Test fun `where the app was, its screen, and how long after it came back on screen`() {
        assertEquals("on settings/qobuz, 0.6 s after the app came back on screen", RenderStall.where("settings/qobuz", 612))
        assertEquals("on home", RenderStall.where("home", -1))
    }
}
