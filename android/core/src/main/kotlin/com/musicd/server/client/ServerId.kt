package com.musicd.server.client

import org.json.JSONObject

/**
 * Which server answered (bug list item 158): its id, from GET /api/ping, kept once this phone's sign-in has been taken
 * by it. "Home" was any Wi-Fi where the home address answered: another network with the same private address had the
 * phone take it for home and send it its sign-in, and another Mandarin server there signed the phone out.
 */
object ServerId {
    /** The id in a ping's [body], or null (a server from before ids, or not a ping's answer). */
    fun of(body: String?): String? {
        if (body == null) return null
        return runCatching { JSONObject(body).optString("id").takeIf { it.isNotEmpty() } }.getOrNull()
    }

    /** The server that [answered] is this phone's ([kept]): the same id, or nothing to tell them apart by yet. */
    fun ours(kept: String?, answered: String?): Boolean = kept == null || answered == null || kept == answered
}
