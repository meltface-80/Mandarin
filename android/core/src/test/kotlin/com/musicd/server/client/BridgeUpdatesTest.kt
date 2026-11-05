package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Mandarin Bridges' rows on Settings → Updates (item 291): their names, and their buttons as each stands. */
class BridgeUpdatesTest {
    private fun bridge(vararg kv: Pair<String, Any?>): JSONObject {
        val o = JSONObject().put("id", "UPNP_r7").put("name", "FiiO R7 USB").put("version", "0.2.0").put("reachable", true).put("updates", true)
            .put("available", false).put("latest", JSONObject().put("commit", "fffffff").put("version", "0.2.0")).put("update", JSONObject().put("state", "idle"))
        for ((k, v) in kv) o.put(k, v ?: JSONObject.NULL)
        return o
    }

    @Test fun eachAsItStands() {
        val rows = BridgeUpdates.rows(JSONObject().put("bridges", org.json.JSONArray()
            .put(bridge("available" to true))
            .put(bridge())
            .put(bridge("update" to JSONObject().put("state", "installing"), "available" to true))
            .put(bridge("update" to JSONObject().put("state", "needs-you")))
            .put(bridge("update" to JSONObject().put("state", "failed"), "available" to true))
            .put(bridge("updates" to false, "available" to true))
            .put(bridge("reachable" to false, "version" to null))
            .put(bridge("latest" to null))))
        assertEquals(listOf("Update available", "Check for update", "Updating…", "Finish on the device", "Try the update again", "Update by hand once", "Not answering", "Check for update"),
            rows.map { it.words })
        assertEquals(listOf(true, false, false, false, true, false, false, false), rows.map { it.canUpdate })
        // Nothing to be done: Check for update, as the server's and the app's rows, and what a check of it says (item 293).
        assertEquals(listOf(null, "Up to date", null, null, null, null, null, "Nothing published"), rows.map { it.checked })
        assertEquals(listOf("Update available", "Up to date", "Not answering", "Nothing published", "Check failed"),
            listOf(rows[0], rows[1], rows[6], rows[7], null).map { BridgeUpdates.answer(it) })
        assertEquals("FiiO R7 USB · Bridge v0.2.0", rows[0].name)
        assertEquals("FiiO R7 USB · Bridge", rows[6].name)
        assertTrue(BridgeUpdates.underWay(rows))
        assertFalse(BridgeUpdates.underWay(rows.take(2)))
    }

    @Test fun noneSaid() {
        assertEquals(emptyList<BridgeRow>(), BridgeUpdates.rows(null))
        assertEquals(emptyList<BridgeRow>(), BridgeUpdates.rows(JSONObject()))
    }
}
