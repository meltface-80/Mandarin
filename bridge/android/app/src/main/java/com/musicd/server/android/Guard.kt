package com.musicd.server.android

import java.net.URI

/**
 * The Bridge's port has no sign-in, so what may change it is kept to what Mandarin sends (item 352, as the Linux
 * Bridge's Guard.cs): a POST only as application/json, which a web page on another site can't send without the browser
 * asking first (and the Bridge never says yes), and never from another site where the browser names where it comes
 * from (Origin). Before, a page open in a browser on the home network could start a recording of what the DAC is fed
 * with a plain form's POST. An update is never to an older release (Updater.kt).
 */
object Guard {
    /** Why [r] may not change anything; null where it may (anything but a POST may). */
    fun refused(r: HttpServer.Request): String? {
        if (r.method != "POST") return null
        val type = (r.header("content-type") ?: "").substringBefore(';').trim()
        if (!type.equals("application/json", ignoreCase = true) && !type.endsWith("+json", ignoreCase = true)) return "only JSON (application/json) is taken"
        val origin = r.header("origin")?.takeIf { it.isNotEmpty() } ?: return null   // not a browser's page: Mandarin's server
        val o = runCatching { URI(origin) }.getOrNull() ?: return "from another site"
        val host = r.header("host") ?: ""
        val own = if (o.port < 0) o.host else "${o.host}:${o.port}"
        return if (own.equals(host, ignoreCase = true)) null else "from another site"
    }

    /** Whether release [tag] ("mandarin-bridge-v0.3.2") is older than [running] ("0.3.2"); test-bridge, and a version not read, never are. */
    fun older(tag: String, running: String): Boolean {
        val prefix = "mandarin-bridge-v"
        if (!tag.startsWith(prefix)) return false
        fun read(v: String): List<Int>? = v.split('-', '+')[0].split('.').map { it.toIntOrNull() ?: return null }
        val t = read(tag.removePrefix(prefix)) ?: return false
        val r = read(running) ?: return false
        for (i in 0 until maxOf(t.size, r.size)) {
            val a = t.getOrElse(i) { 0 }; val b = r.getOrElse(i) { 0 }
            if (a != b) return a < b
        }
        return false
    }
}
