package com.musicd.server.android

import android.content.Context
import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections

/**
 * The page never moves. MusicD's page stays on the server's home address
 * whether the phone is at home or away; the WebView is told (see
 * [MainActivity]) to send that one address's traffic through this relay on
 * the phone, and the relay passes each connection on to wherever the server
 * can be reached right now — the home network, MusicD's own Tailscale
 * connection, or the Tailscale app. So leaving the house or coming home
 * never reloads the page: nothing you were looking at goes, and what the
 * page keeps (its theme, the Library's view) stays with it.
 *
 * It relays bytes, not requests: the WebView speaks to it as to a web proxy
 * (the request line carries the full address, which the server accepts),
 * and a change of route closes the connections open on the old one — the
 * page's next request opens a new one on the new route. Only on 127.0.0.1.
 */
object PageRelay {
    private const val TAG = "PageRelay"
    const val PORT = 34600

    @Volatile private var server: ServerSocket? = null
    private val open = Collections.synchronizedSet(HashSet<Socket>())
    @Volatile private var lastTarget: String? = null

    /** Listening (idempotent). False if the port can't be had — the page then loads as before. */
    @Synchronized
    fun start(context: Context): Boolean {
        server?.let { if (!it.isClosed) return true }
        val app = context.applicationContext
        val s = runCatching {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT))
            }
        }.getOrElse { Log.w(TAG, "can't listen on $PORT: ${it.message}"); return false }
        server = s
        Thread({
            while (!s.isClosed) {
                val client = runCatching { s.accept() }.getOrNull() ?: continue
                Thread({ relay(app, client) }, "page-relay").apply { isDaemon = true; start() }
            }
        }, "page-relay-accept").apply { isDaemon = true; start() }
        // A new route: connections on the old one are dropped (they'd only hang).
        Away.listen { retarget(app) }
        return true
    }

    /** Close every open connection if the way to the server has changed. */
    fun retarget(context: Context) {
        val t = Store.active(context)?.let { "${it.host}:${it.port}" }
        if (t == lastTarget) return
        lastTarget = t
        synchronized(open) { open.toList() }.forEach { runCatching { it.close() } }
    }

    private fun relay(c: Context, client: Socket) {
        val to = Store.active(c)
        if (to == null) { runCatching { client.close() }; return }
        lastTarget = "${to.host}:${to.port}"
        val upstream = Socket()
        try {
            upstream.connect(InetSocketAddress(to.host, to.port), 5_000)
            upstream.tcpNoDelay = true
            client.tcpNoDelay = true
        } catch (e: Exception) {
            runCatching { client.close() }; runCatching { upstream.close() }
            return
        }
        open += client; open += upstream
        val done = {
            runCatching { client.close() }; runCatching { upstream.close() }
            open -= client; open -= upstream
        }
        Thread({ pipe(upstream.getInputStream(), client.getOutputStream()); done() }, "page-relay-down")
            .apply { isDaemon = true; start() }
        pipe(client.getInputStream(), upstream.getOutputStream())
        done()
    }

    private fun pipe(from: InputStream, to: OutputStream) {
        val buf = ByteArray(32 * 1024)
        try {
            while (true) {
                val n = from.read(buf)
                if (n < 0) break
                to.write(buf, 0, n)
                to.flush()
            }
        } catch (e: Exception) { /* closed at either end */ }
    }
}
