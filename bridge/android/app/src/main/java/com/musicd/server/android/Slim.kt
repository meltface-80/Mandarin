package com.musicd.server.android

import android.util.Log
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * Mandarin Bridge as a SlimProto player (item 315): how Mandarin plays it, where before it was a UPnP renderer.
 * SlimProto is Squeezebox's and Squeezelite's, open; Mandarin is its server (Renderers/Slim/ on the server). The
 * Bridge finds Mandarin by a UDP broadcast to port 3483 ('e', answered 'E'), connects to TCP 3483, says hello (HELO:
 * its id, and what it plays, with its own web port so Mandarin finds /dac.json, its updates and its log), and does
 * what Mandarin's strm says through the same player as ever ([Transport]): 's' a track (to wait for 'u', or to start;
 * given while one plays, the next, gapless), 'q' stop, 'p' pause, 'u' go on, 't' how are you. It says what happens
 * (STAT): STMs a track begun, STMd its stream read (Mandarin then gives the next), STMl buffered, waiting for Play,
 * STMp, STMr, STMu all played, STMn a track it couldn't play, STMt with how far in. The volume is audg's gain.
 * Its hello says it takes Mandarin's continuous PCM (item 322): a strm s of PCM ('p') is a run, one stream of samples
 * alone, track on into track, its format said in the strm and put on its address for [RawPcmExtractor]
 * ("#pcm=s24le:96000:2"); Mandarin tells it each track it comes to in the run (mtrk), for the screen and notification.
 *
 * A frame from the server: 2 bytes of length, four letters, the rest; one to it: four letters, 4 bytes of length.
 */
class Slim(private val service: DacService, private val transport: Transport) {
    companion object {
        private const val TAG = "Slim"
        private const val DEVICE_STOPPED = 1   // a STMn's error: the DAC or the network, not the track (Mandarin's SlimFrames.Failed)
        const val PORT = 3483
        private val RATES = intArrayOf(11025, 22050, 32000, 44100, 48000, 8000, 12000, 16000, 24000, 96000, 88200, 176400, 192000, 352800, 384000, 0, 705600, 768000, 1411200, 1536000)
    }

    @Volatile private var running = false
    @Volatile private var out: OutputStream? = null
    private var thread: Thread? = null
    /** The Mandarin it is played by, while connected: its address. */
    @Volatile var server: InetAddress? = null
        private set
    /** When Mandarin last said anything to it (a command, or 't' every second). */
    @Volatile var lastHeard = 0L
        private set

    // What it is told and has said, on the main thread (the transport's).
    private var flushed = true
    private var waiting = false
    private var sentLoaded = false
    private var sentEnded = false
    private var startedUri: String? = null
    private var erred: String? = null
    private var paused = false

    fun start() {
        if (running) return
        running = true
        thread = Thread({ loop() }, "slimproto").also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        runCatching { out?.close() }
        thread?.interrupt()
    }

    /** Found, connected and played, until stopped; found again whenever the connection ends. */
    private fun loop() {
        while (running) {
            val at = server ?: discover()
            if (at == null) { sleep(5000); continue }
            try { connect(at) } catch (e: IOException) { Log.i(TAG, "connection to $at ended: ${e.message}") }
            server = null; out = null
            if (running) sleep(3000)
        }
    }

    private fun sleep(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) {}

    /** Mandarin's address: its answer to a broadcast 'e' on port 3483, or null after three seconds of none. */
    private fun discover(): InetAddress? = try {
        DatagramSocket().use { s ->
            s.broadcast = true
            s.soTimeout = 3000
            val ask = byteArrayOf('e'.code.toByte())
            s.send(DatagramPacket(ask, ask.size, InetAddress.getByName("255.255.255.255"), PORT))
            val buf = ByteArray(512)
            val p = DatagramPacket(buf, buf.size)
            s.receive(p)
            if (p.length > 0 && buf[0] == 'E'.code.toByte()) p.address else null
        }
    } catch (_: IOException) { null }

    private fun connect(at: InetAddress) {
        Socket().use { sock ->
            sock.tcpNoDelay = true
            sock.connect(InetSocketAddress(at, PORT), 5000)
            sock.soTimeout = 35_000   // Mandarin says 't' every second; half a minute of nothing, and it is gone
            server = at
            out = sock.getOutputStream()
            Log.i(TAG, "connected to Mandarin at ${at.hostAddress}")
            hello()
            val inp = DataInputStream(sock.getInputStream().buffered())
            while (running) {
                val len = inp.readUnsignedShort()
                if (len < 4) throw IOException("short frame")
                val op = ByteArray(4).also { inp.readFully(it) }
                val body = ByteArray(len - 4).also { inp.readFully(it) }
                lastHeard = System.currentTimeMillis()
                frame(String(op, Charsets.US_ASCII), body)
            }
        }
    }

    private fun send(op: String, body: ByteArray) {
        val o = out ?: return
        val b = ByteBuffer.allocate(8 + body.size).put(op.toByteArray(Charsets.US_ASCII)).putInt(body.size).put(body).array()
        try { synchronized(this) { o.write(b); o.flush() } } catch (e: IOException) { Log.i(TAG, "send $op: ${e.message}") }
    }

    /** Its id: six bytes from its UDN, as a MAC (locally administered), the same every time. */
    private fun mac(): ByteArray {
        val h = MessageDigest.getInstance("SHA-256").digest(Store.udn(service).toByteArray())
        return ByteArray(6) { h[it] }.also { it[0] = ((it[0].toInt() and 0xFC) or 0x02).toByte() }
    }

    /** What it plays: what the DAC on its port takes (its highest rate), FLAC, PCM and DSD; its own web port, and its UDN (the UPnP device it was, whose settings Mandarin keeps on it). */
    private fun capabilities(): String {
        val rates = service.dacJson().optJSONObject("dac")?.optJSONArray("rates")
        val max = if (rates != null && rates.length() > 0) (0 until rates.length()).maxOf { rates.optInt(it) } else 192000
        return "Model=mandarinbridge,ModelName=${Transport.MODEL},Firmware=${BuildConfig.VERSION_NAME},MaxSampleRate=$max,MandarinBridge=${Store.PORT},UDN=${Store.udn(service)},ContinuousPcm=1,flc,pcm,wav,dsf,dff"
    }

    /** Mandarin told again what it plays (a DAC plugged in or taken out, a new address): a hello again, where connected. */
    fun rehello() { if (out != null) Thread { hello() }.start() }

    private fun hello() {
        val caps = capabilities().toByteArray(Charsets.UTF_8)
        val b = ByteBuffer.allocate(36 + caps.size)
        b.put(12.toByte()); b.put(0.toByte()); b.put(mac())
        b.put(ByteArray(16)); b.putShort(0); b.putInt(0); b.putInt(0); b.put(ByteArray(2))
        b.put(caps)
        send("HELO", b.array())
    }

    /** A STAT: [event], with how far into the track it is. */
    private fun stat(event: String, timestamp: Int = 0, error: Int = 0) {
        val ms = runCatching { transport.onMain { transport.positionMs() } }.getOrDefault(0L)
        val b = ByteBuffer.allocate(53)
        b.put(event.toByteArray(Charsets.US_ASCII))
        b.position(37); b.putInt((ms / 1000).toInt())
        b.position(43); b.putInt(ms.toInt())
        b.position(47); b.putInt(timestamp)
        b.position(51); b.putShort(error.toShort())
        send("STAT", b.array())
    }

    private fun frame(op: String, b: ByteArray) {
        when (op) {
            "strm" -> strm(b)
            "audg" -> if (b.size >= 18) volume(ByteBuffer.wrap(b, 10, 4).int)
            "setd" -> if (b.isNotEmpty() && b[0] == 0.toByte() && b.size == 1)
                send("SETD", byteArrayOf(0) + (Store.friendlyName(service) + "\u0000").toByteArray(Charsets.UTF_8))
            "mtrk" -> told(String(b, Charsets.US_ASCII))
            "aude", "serv" -> {}
            else -> Log.i(TAG, "unhandled $op")
        }
    }

    private fun strm(b: ByteArray) {
        if (b.size < 24) return
        val bb = ByteBuffer.wrap(b)
        when (b[0].toInt().toChar()) {
            't' -> stat("STMt", bb.getInt(14))
            'q' -> { onMain { flushed = true; waiting = false; startedUri = null }; transport.stop(); stat("STMf") }
            'p' -> { transport.pause(); stat("STMp") }
            'u' -> { onMain { waiting = false }; transport.play(); stat("STMr") }
            's' -> {
                val autostart = b[1].toInt().toChar()
                val port = bb.getShort(18).toInt() and 0xFFFF
                val ip = bb.getInt(20)
                val request = String(b, 24, b.size - 24, Charsets.ISO_8859_1)
                val host = if (ip == 0) server?.hostAddress ?: return else InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(ip).array()).hostAddress
                val said = item("http://$host:$port", request) ?: return
                // A run of Mandarin's PCM: what its samples are, on its address.
                val item = raw(b)?.let { Transport.Item(said.uri + it, said.title, said.artist, said.album) } ?: said
                stat("STMc")
                // After a stop, or with nothing playing: the track itself; else the next, gapless after the one playing.
                val asNext = onMain { !flushed && transport.current != null }
                if (asNext) transport.setNext(item)
                else {
                    onMain { flushed = false; waiting = autostart == '0'; sentLoaded = false; sentEnded = false }
                    transport.set(item, start = autostart != '0')
                }
            }
        }
    }

    /** The track a strm s asks for: its address from the request's path, and what Mandarin said of it in its headers. */
    private fun item(base: String, request: String): Transport.Item? {
        val lines = request.split("\r\n")
        val path = lines.firstOrNull()?.split(" ")?.getOrNull(1) ?: return null
        return Transport.Item(base + path, header(lines, "X-Mandarin-Title"), header(lines, "X-Mandarin-Artist"), header(lines, "X-Mandarin-Album"))
    }

    private fun header(lines: List<String>, name: String) = lines.firstOrNull { it.startsWith("$name:", ignoreCase = true) }?.substringAfter(':')?.trim()
        ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) } ?: ""

    /** A strm s of PCM ('p', item 322): its samples' format as [RawPcmExtractor] reads it ("#pcm=s24le:96000:2"); null for any other stream. */
    private fun raw(b: ByteArray): String? {
        if (b.size < 7 || b[2] != 'p'.code.toByte()) return null
        val bits = when (b[3].toInt().toChar()) { '1' -> 16; '2' -> 24; '3' -> 32; else -> return null }
        val r = b[4] - '0'.code.toByte(); val channels = b[5] - '0'.code.toByte()
        if (r < 0 || r >= RATES.size || RATES[r] == 0 || channels !in 1..8 || b[6] != '1'.code.toByte()) return null
        return "#pcm=s${bits}le:${RATES[r]}:$channels"
    }

    /** Mandarin told it the track it has come to in the run it plays (mtrk, item 322): what it is, for the screen and notification. */
    private fun told(headers: String) {
        val lines = headers.split("\r\n")
        transport.retitle(header(lines, "X-Mandarin-Title"), header(lines, "X-Mandarin-Artist"), header(lines, "X-Mandarin-Album"))
    }

    /** The volume Mandarin sets: its gain (16.16, 1 the whole), the DAC's own where it has one and isn't fixed. */
    private fun volume(gain: Int) {
        val pct = Math.round((gain.toLong() and 0xFFFFFFFFL) * 100.0 / 65536).toInt().coerceIn(0, 100)
        if (UsbDriver.controlsVolume) UsbDriver.setVolume(pct)
    }

    private fun <T> onMain(f: () -> T): T = transport.onMain(f)

    /** The transport changed (main thread): what Mandarin needs to hear of it, said once. */
    fun changed() {
        if (out == null) return
        val cur = transport.current
        val state = transport.transportState()
        if (cur != null && state == "PLAYING" && cur.uri != startedUri) {
            startedUri = cur.uri; erred = null
            Thread { stat("STMs"); stat("STMd") }.start()   // begun; its stream is the player's to read: the next may come
        }
        // Paused or gone on from the Bridge itself (its notification): Mandarin follows.
        val nowPaused = state == "PAUSED_PLAYBACK"
        if (nowPaused != paused) { paused = nowPaused; if (startedUri != null) Thread { stat(if (nowPaused) "STMp" else "STMr") }.start() }
        if (waiting && !sentLoaded && transport.readyToStart()) { sentLoaded = true; Thread { stat("STMl") }.start() }
        if (!sentEnded && transport.ended()) { sentEnded = true; Thread { stat("STMu") }.start() }
        val e = transport.error
        // STMn with its error (Mandarin's SlimFrames.Failed): 1 the DAC or the network, none the track's format.
        if (e != null && e != erred) { erred = e; val code = if (transport.trackFailed) 0 else DEVICE_STOPPED; Thread { stat("STMn", error = code) }.start() }
    }
}
