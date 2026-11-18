package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Upload bandwidth (item 479) as the page says it (settings-ibroadcast-bandwidth.js), from the state's upload_speed. */
class IBroadcastBandwidthTest {
    private fun state(s: String) = JSONObject("""{"connected":true,"upload_speed":$s}""")

    @Test fun noSpeedIsNoLimit() {
        val b = IBroadcastBandwidthWords.parse(state("""{"speed_mbps":null,"percent":100,"limit_mbps":null,"fastest_mbps":null}"""))
        assertNull(b.speed)
        assertEquals("No limit", b.said)
        assertEquals("", b.speedText)
        assertEquals("No limit: uploads use as much of your upload as they can. Enter your upload speed to set one.", b.limitWords)
        assertEquals(IBroadcastBandwidthWords.SPEED_NOTE, b.speedNote)
    }

    @Test fun aShareOfTheSpeedAndWhatItLeaves() {
        val b = IBroadcastBandwidthWords.parse(state("""{"speed_mbps":108,"percent":75,"limit_mbps":81,"fastest_mbps":98.4}"""))
        assertEquals("Up to 81 Mbps", b.said)
        assertEquals("108", b.speedText)
        assertEquals("Uploads use up to 81 Mbps, leaving 27 Mbps for everything else.", b.limitWords)
        assertEquals(IBroadcastBandwidthWords.SPEED_NOTE + " The fastest an upload has sent from here: 98 Mbps.", b.speedNote)
    }

    @Test fun allOfItAndSmallSpeedsToATenth() {
        assertEquals("Uploads use up to 108 Mbps: all of your upload.",
            IBroadcastBandwidthWords.parse(state("""{"speed_mbps":108,"percent":100,"limit_mbps":108}""")).limitWords)
        val small = IBroadcastBandwidthWords.parse(state("""{"speed_mbps":2.5,"percent":50,"limit_mbps":1.3}"""))
        assertEquals("Up to 1.3 Mbps", small.said)
        assertEquals("2.5", small.speedText)
    }

    @Test fun anUploadsSpeedInMbps() {
        // 12.2 MB/s, as the page said it before, is 98 Mbps.
        assertEquals("98 Mbps", IBroadcastBandwidthWords.ofBytes(12.2e6))
        val words = IBroadcastSettings.uploadWords(JSONObject("""{"running":true,"files_total":46,"files_done":2,"bytes_total":1.1e9,"bytes_done":5.19e7,"speed":1.22e7,"eta":60}"""), { "" })
        assertEquals("2 of 46 files · 51.9 MB of 1.1 GB · 98 Mbps · about 1 min left", words.progress)
    }

    @Test fun whatIsTypedAsTheServerTakesIt() {
        assertEquals(108.0, IBroadcastBandwidthWords.typed(" 108 "))
        assertEquals(2.5, IBroadcastBandwidthWords.typed("2,5"))
        assertEquals(JSONObject.NULL, IBroadcastBandwidthWords.typed(""))
        assertNull(IBroadcastBandwidthWords.typed("fast"))
        assertNull(IBroadcastBandwidthWords.typed("0"))
    }
}
