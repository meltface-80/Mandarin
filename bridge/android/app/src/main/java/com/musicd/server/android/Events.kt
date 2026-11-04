package com.musicd.server.android

import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * UPnP eventing (GENA), the device's side: a control point SUBSCRIBEs to a
 * service with a callback address and is given a subscription id and a
 * lifetime; from then on, every change of the service's evented variables
 * is POSTed to it as a NOTIFY (AVTransport and RenderingControl wrap theirs
 * in a LastChange document), the first one at once with everything. A
 * subscription is renewed by its id, UNSUBSCRIBEd on the way out, or
 * forgotten when it runs out or its callback stops answering.
 */
class Events(private val service: String) {
    companion object {
        private const val TAG = "Events"
        private const val TIMEOUT_S = 1800
    }

    private class Sub(val sid: String, val callbacks: List<String>, @Volatile var expires: Long, var seq: Long = 0, var failures: Int = 0)

    private val subs = ArrayList<Sub>()
    private val sender = Executors.newSingleThreadExecutor()

    /** SUBSCRIBE (a new one, or a renewal with [sid]): the id and the lifetime to answer with, or null to refuse. */
    @Synchronized
    fun subscribe(sid: String?, callback: String?, timeoutHeader: String?, current: () -> String): Pair<String, Int>? {
        prune()
        val life = Regex("Second-(\\d+)", RegexOption.IGNORE_CASE).find(timeoutHeader ?: "")?.groupValues?.get(1)?.toIntOrNull()?.coerceIn(60, 86400) ?: TIMEOUT_S
        if (sid != null) {
            val s = subs.firstOrNull { it.sid == sid } ?: return null
            s.expires = System.currentTimeMillis() + life * 1000L
            return Pair(s.sid, life)
        }
        val urls = Regex("<([^>]+)>").findAll(callback ?: "").map { it.groupValues[1] }.filter { it.startsWith("http://") }.toList()
        if (urls.isEmpty()) return null
        val s = Sub("uuid:" + UUID.randomUUID(), urls, System.currentTimeMillis() + life * 1000L)
        subs.add(s)
        Log.i(TAG, "$service: subscribed ${urls[0]}")
        // The first event carries the state as it is.
        val body = current()
        sender.execute { notify(s, body) }
        return Pair(s.sid, life)
    }

    @Synchronized
    fun unsubscribe(sid: String): Boolean = subs.removeAll { it.sid == sid }

    @Synchronized
    fun count(): Int { prune(); return subs.size }

    /** Something changed: [lastChange] (the LastChange document, or any propertyset body) to every subscriber. */
    @Synchronized
    fun changed(propertySet: String) {
        prune()
        if (subs.isEmpty()) return
        val targets = subs.toList()
        sender.execute { for (s in targets) notify(s, propertySet) }
    }

    private fun prune() { val now = System.currentTimeMillis(); subs.removeAll { it.expires < now } }

    /**
     * One NOTIFY to each of the subscriber's callbacks, written by hand on a
     * socket: Android's HttpURLConnection refuses a method it doesn't know,
     * and the server reads the method's name.
     */
    private fun notify(s: Sub, body: String) {
        val seq: Long
        synchronized(this) { if (!subs.contains(s)) return; seq = s.seq++ }
        val bytes = body.toByteArray(Charsets.UTF_8)
        for (url in s.callbacks) {
            try {
                val u = URL(url)
                val port = if (u.port > 0) u.port else 80
                val path = (if (u.path.isNullOrEmpty()) "/" else u.path) + (u.query?.let { "?$it" } ?: "")
                Socket().use { sock ->
                    sock.connect(InetSocketAddress(u.host, port), 5000)
                    sock.soTimeout = 5000
                    val head = "NOTIFY $path HTTP/1.1\r\nHOST: ${u.host}:$port\r\nCONTENT-TYPE: text/xml; charset=\"utf-8\"\r\nCONTENT-LENGTH: ${bytes.size}\r\n" +
                        "NT: upnp:event\r\nNTS: upnp:propchange\r\nSID: ${s.sid}\r\nSEQ: $seq\r\nConnection: close\r\n\r\n"
                    val out = sock.getOutputStream()
                    out.write(head.toByteArray(Charsets.ISO_8859_1)); out.write(bytes); out.flush()
                    val line = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.ISO_8859_1)).readLine() ?: ""
                    val code = line.split(' ').getOrNull(1)?.toIntOrNull() ?: 0
                    if (code in 200..299) { synchronized(this) { s.failures = 0 }; return }
                    Log.i(TAG, "$service: NOTIFY $url answered $line")
                }
            } catch (e: IOException) {
                Log.i(TAG, "$service: NOTIFY $url: ${e.message}")
            }
        }
        synchronized(this) { if (++s.failures >= 3) { subs.remove(s); Log.i(TAG, "$service: ${s.callbacks[0]} dropped after ${s.failures} failures") } }
    }

    /** The LastChange propertyset for AVTransport or RenderingControl: [vars] as val attributes under InstanceID 0. */
    fun lastChange(ns: String, vars: List<Pair<String, String>>, channel: Set<String> = emptySet()): String {
        val ev = StringBuilder("<Event xmlns=\"$ns\"><InstanceID val=\"0\">")
        for ((k, v) in vars) ev.append('<').append(k).append(if (k in channel) " channel=\"Master\"" else "").append(" val=\"").append(Xml.escape(v)).append("\"/>")
        ev.append("</InstanceID></Event>")
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?><e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"><e:property><LastChange>" + Xml.escape(ev.toString()) + "</LastChange></e:property></e:propertyset>"
    }

    /** A plain propertyset (ConnectionManager). */
    fun propertySet(vars: List<Pair<String, String>>): String {
        val sb = StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?><e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">")
        for ((k, v) in vars) sb.append("<e:property><").append(k).append('>').append(Xml.escape(v)).append("</").append(k).append("></e:property>")
        return sb.append("</e:propertyset>").toString()
    }
}
