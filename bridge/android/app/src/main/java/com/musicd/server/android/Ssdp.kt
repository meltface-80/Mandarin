package com.musicd.server.android

import android.util.Log
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface

/**
 * SSDP: how a UPnP device is found. The renderer listens on the multicast
 * group for M-SEARCH requests and answers each one that asks for it (a
 * root device, a MediaRenderer, one of its services, its own uuid, or
 * everything); it announces itself (NOTIFY ssdp:alive) when it starts, every
 * ten minutes after, and whenever its description changes — a DAC plugged
 * in or taken out — so Mandarin reads it afresh; and says goodbye when it stops.
 *
 * [location] is read each time: it carries the description's address, which
 * changes with the DAC (DacService), so a control point that caches by
 * address reads the new one.
 */
class Ssdp(private val udn: String, private val location: () -> String?, private val iface: () -> NetworkInterface?) {
    companion object {
        private const val TAG = "Ssdp"
        private const val GROUP = "239.255.255.250"
        private const val PORT = 1900
        private const val MAX_AGE = 1800
        const val ALIVE_EVERY_MS = 600_000L
    }

    private val group: InetAddress = InetAddress.getByName(GROUP)
    private var socket: MulticastSocket? = null
    @Volatile private var running = false
    private val server = "Android/${android.os.Build.VERSION.RELEASE} UPnP/1.0 MandarinBridge/${BuildConfig.VERSION_NAME}"

    /** What this device answers to, with the USN for each. */
    private fun targets(): List<Pair<String, String>> = listOf(
        "upnp:rootdevice" to "$udn::upnp:rootdevice",
        udn to udn,
        Scpd.DEVICE to "$udn::${Scpd.DEVICE}",
        Scpd.AVT to "$udn::${Scpd.AVT}",
        Scpd.RCS to "$udn::${Scpd.RCS}",
        Scpd.CMS to "$udn::${Scpd.CMS}"
    )

    fun start() {
        val s = MulticastSocket(null).apply { reuseAddress = true; bind(InetSocketAddress(PORT)) }
        try {
            val ni = iface()
            if (ni != null) { s.networkInterface = ni; s.joinGroup(InetSocketAddress(group, PORT), ni) } else s.joinGroup(group)
            s.timeToLive = 4
        } catch (e: IOException) { Log.w(TAG, "join", e) }
        socket = s
        running = true
        Thread({ listen(s) }, "ssdp-listen").apply { isDaemon = true; start() }
        alive()
    }

    fun stop() {
        running = false
        runCatching { byebye() }
        runCatching { socket?.close() }
        socket = null
    }

    private fun listen(s: MulticastSocket) {
        val buf = ByteArray(4096)
        while (running) {
            val p = DatagramPacket(buf, buf.size)
            try { s.receive(p) } catch (e: IOException) { if (running) Log.i(TAG, "receive: ${e.message}"); break }
            val text = String(p.data, 0, p.length, Charsets.ISO_8859_1)
            if (!text.startsWith("M-SEARCH", ignoreCase = true)) continue
            val h = headers(text)
            if (h["man"]?.contains("ssdp:discover") != true) continue
            val st = h["st"] ?: continue
            val loc = location() ?: continue
            val wanted = if (st.equals("ssdp:all", true)) targets() else targets().filter { it.first.equals(st, true) }
            for ((t, usn) in wanted) {
                val msg = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=$MAX_AGE\r\nDATE: ${date()}\r\nEXT:\r\nLOCATION: $loc\r\nSERVER: $server\r\nST: $t\r\nUSN: $usn\r\nBOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n"
                send(msg, p.address, p.port)
            }
        }
    }

    /** "Here I am", to the group, for every target. */
    fun alive() = notify("ssdp:alive")
    private fun byebye() = notify("ssdp:byebye")

    private fun notify(nts: String) {
        val loc = location() ?: return
        for ((t, usn) in targets()) {
            val msg = "NOTIFY * HTTP/1.1\r\nHOST: $GROUP:$PORT\r\nCACHE-CONTROL: max-age=$MAX_AGE\r\nLOCATION: $loc\r\nNT: $t\r\nNTS: $nts\r\nSERVER: $server\r\nUSN: $usn\r\nBOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n"
            send(msg, group, PORT)
        }
    }

    private fun send(msg: String, to: InetAddress, port: Int) {
        val bytes = msg.toByteArray(Charsets.ISO_8859_1)
        val packet = DatagramPacket(bytes, bytes.size, to, port)
        try {
            if (to.isMulticastAddress) socket?.send(packet) else DatagramSocket().use { it.send(packet) }
        } catch (e: IOException) { Log.i(TAG, "send to $to: ${e.message}") }
    }

    private fun headers(text: String): Map<String, String> {
        val m = HashMap<String, String>()
        for (l in text.split("\r\n").drop(1)) { val i = l.indexOf(':'); if (i > 0) m[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim() }
        return m
    }

    private fun date(): String = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("GMT") }.format(java.util.Date())
}
