package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseTest {
    @Test fun versionsCompareByNumber() {
        assertTrue(Release.compare("0.3.10", "0.3.9") > 0)
        assertTrue(Release.compare("0.4.0", "0.3.99") > 0)
        assertEquals(0, Release.compare("v0.3.4", "0.3.4"))
        assertTrue(Release.compare("0.3.3", "0.3.4") < 0)
        assertEquals(0, Release.compare("0.3", "0.3.0"))
    }

    @Test fun releaseCandidates() {
        assertTrue(Release.compare("0.6.0-RC1", "0.5.58") > 0)
        assertTrue(Release.compare("0.6.0", "0.6.0-RC1") > 0)
        assertTrue(Release.compare("0.6.0-RC2", "0.6.0-RC1") > 0)
        assertTrue(Release.compare("0.6.0-RC10", "0.6.0-RC2") > 0)
        assertTrue(Release.compare("0.6.1", "0.6.0") > 0)
        assertEquals(0, Release.compare("v0.6.0-RC1", "0.6.0-rc1"))
        assertFalse(Release("0.6.0-RC1", "https://x", "").newerThan("0.6.0"))
        assertTrue(Release("0.6.0", "https://x", "").newerThan("0.6.0-RC1"))
    }

    /** Test builds (bug list item 141): dev's APK is the next release with -tN; the release is offered over it, the last one isn't. */
    @Test fun testBuilds() {
        assertTrue(Release.compare("1.1.4-t1", "1.1.3") > 0)
        assertTrue(Release.compare("1.1.4-t2", "1.1.4-t1") > 0)
        assertTrue(Release.compare("1.1.4-t10", "1.1.4-t9") > 0)
        assertTrue(Release("1.1.4", "https://x", "").newerThan("1.1.4-t7"))
        assertFalse(Release("1.1.3", "https://x", "").newerThan("1.1.4-t7"))
    }

    @Test fun latestJsonAsPublished() {
        val r = Release.parse(JSONObject("""
            {"version": "0.3.4",
             "url": "https://github.com/meltface-80/MusicD-Server/raw/main/dist/musicd-server-android-0.3.4-debug.apk",
             "sha256": "ABCDEF"}
        """))!!
        assertEquals("abcdef", r.sha256)
        assertTrue(r.newerThan("0.3.3"))
        assertFalse(r.newerThan("0.3.4"))
        assertNull(Release.parse(JSONObject("""{"version": "0.3.4", "url": "http://example.com/a.apk"}""")))
        assertNull(Release.parse(JSONObject("{}")))
    }
}
