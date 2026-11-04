package com.musicd.server.android

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * A recording of exactly what the DAC is fed, for Mandarin's bit-perfect check: the server (its SQ-tool) compares
 * it sample by sample with what it sent. Made only when asked, for a few seconds to two minutes, never by itself.
 *
 * The bytes are those the USB driver's stream took (UsbDriver.tap), after every conversion the app makes: the very
 * words the isochronous transfers carry to the DAC. They are written as SQ-tool writes a capture of its own: a WAV
 * whose container is the DAC's slot (16, 24 or 32 bits) and whose valid bits are the DAC format's, beside a sidecar
 * (`.wav.json`) saying how it was made — the format, native DSD or DoP, where the stream was flushed (a seek), the
 * USB driver's underruns and errors while it ran, the DAC, and the track that was playing.
 *
 *   POST   /capture {"seconds": 30}   start, from the next byte the driver takes (409 while one runs)
 *   GET    /capture                   where it is: idle, armed (no stream yet), recording, done, failed
 *   GET    /capture.wav               the recording, once done
 *   GET    /capture.wav.json          its sidecar
 *   DELETE /capture                   stop; what was recorded is kept and finished
 *
 * The stream changing format (another rate, DSD after PCM) ends it: a WAV has one format. [about] says what is
 * known when it starts (the DAC, the track and where in it), read on the server's thread.
 */
class Capture(private val dir: File, private val about: () -> JSONObject) : UsbDriver.Tap {
    companion object {
        private const val TAG = "Capture"
        const val MAX_SECONDS = 120
        private const val BEHIND_MAX = 64L shl 20   // bytes taken but not yet on disk: more, and the disk can't keep up
    }

    val wav = File(dir, "capture.wav")
    val sidecar = File(dir, "capture.wav.json")
    private val part = File(dir, "capture.wav.part")
    private val disk = Executors.newSingleThreadExecutor { r -> Thread(r, "capture").apply { isDaemon = true } }
    private val behind = AtomicLong()
    private val lock = Any()

    @Volatile private var state = "idle"
    private var why = ""
    private var seconds = 0
    private var context = JSONObject()
    private var stream: UsbDriver.Open? = null
    private var file: RandomAccessFile? = null
    private var target = 0L
    private var taken = 0L
    private var startedAt = 0L
    private var before: JSONObject? = null
    private val interruptions = JSONArray()

    /** Starts one: false while one is armed or recording. */
    fun start(secs: Int): Boolean {
        if (state == "armed" || state == "recording" || state == "finishing") return false
        // Read before the lock: it waits on the main thread, and the stream's thread waits on the lock.
        val ctx = runCatching(about).getOrElse { JSONObject().put("error", it.message) }
        synchronized(lock) {
            if (state == "armed" || state == "recording" || state == "finishing") return false
            seconds = secs.coerceIn(1, MAX_SECONDS)
            context = ctx
            why = ""; taken = 0; target = 0; stream = null; before = null; behind.set(0)
            while (interruptions.length() > 0) interruptions.remove(0)
            dir.mkdirs(); wav.delete(); sidecar.delete(); part.delete()
            state = "armed"
            UsbDriver.tap = this
            Log.i(TAG, "armed for $seconds s")
            return true
        }
    }

    /** Stops one that runs: what was recorded is finished and kept. */
    fun stop() {
        synchronized(lock) {
            if (state == "armed") { UsbDriver.tap = null; state = "idle" }
            else if (state == "recording") finish("stopped")
        }
    }

    override fun took(buf: ByteBuffer, off: Int, len: Int) {
        synchronized(lock) {
            val o = UsbDriver.current ?: return
            if (state == "armed") begin(o) ?: return
            if (state != "recording") return
            if (o !== stream) { finish("the stream changed (another rate or format)"); return }
            val n = minOf(len.toLong(), target - taken).toInt()
            if (n <= 0) return
            if (behind.addAndGet(n.toLong()) > BEHIND_MAX) { fail("the recording couldn't be written fast enough"); return }
            val bytes = ByteArray(n)
            buf.duplicate().apply { position(off) }.get(bytes)
            val f = file
            disk.execute { runCatching { f?.write(bytes) }.onFailure { fail("couldn't write: ${it.message}") }; behind.addAndGet(-n.toLong()) }
            taken += n
            if (taken >= target) finish("done")
        }
    }

    override fun flushed() {
        synchronized(lock) {
            val o = stream ?: return
            if (state != "recording" || taken == 0L) return
            val frame = taken / o.frameBytes
            interruptions.put(JSONObject().put("frame", frame).put("seconds", Math.round(frame * 1000.0 / o.rate) / 1000.0).put("why", "flush"))
        }
    }

    /** The first byte: the format fixed, the file opened. Null when it can't be (a refusal is a failure). */
    private fun begin(o: UsbDriver.Open): Unit? {
        val need = o.rate.toLong() * o.frameBytes * seconds
        if (dir.usableSpace < need + (64L shl 20)) { fail("not enough space for ${need shr 20} MB"); return null }
        try { file = RandomAccessFile(part, "rw").apply { setLength(0); write(header(o, 0)) } }
        catch (e: Exception) { fail("couldn't open the file: ${e.message}"); return null }
        stream = o; target = need; startedAt = System.currentTimeMillis(); before = UsbDriver.stats()
        state = "recording"
        Log.i(TAG, "recording ${o.rate} Hz, ${o.channels} × ${o.subslot * 8}-bit (${o.kind}) for $seconds s")
        return Unit
    }

    /** Ends it (lock held): the header's lengths written, the sidecar beside it. */
    private fun finish(reason: String) {
        UsbDriver.tap = null
        val o = stream ?: run { state = "idle"; return }
        val f = file
        val bytes = taken
        val meta = sidecarJson(o, reason, UsbDriver.stats())
        why = reason
        state = "finishing"
        disk.execute {
            try {
                f?.apply { seek(0); write(header(o, bytes)); close() }
                part.renameTo(wav)
                sidecar.writeText(meta.toString(2))
                synchronized(lock) { if (state == "finishing") state = "done" }
                Log.i(TAG, "done: ${bytes / o.frameBytes} frames ($reason)")
            } catch (e: Exception) { fail("couldn't finish: ${e.message}") }
        }
    }

    private fun fail(reason: String) {
        synchronized(lock) {
            UsbDriver.tap = null
            why = reason; state = "failed"
            runCatching { file?.close() }; part.delete()
            Log.w(TAG, reason)
        }
    }

    private fun header(o: UsbDriver.Open, data: Long): ByteArray =
        CaptureWav.header(o.rate, o.channels, o.subslot, if (o.dsd) o.subslot * 8 else o.bits, data)

    private fun sidecarJson(o: UsbDriver.Open, reason: String, after: JSONObject?): JSONObject {
        fun delta(k: String) = (after?.optLong(k) ?: 0L) - (before?.optLong(k) ?: 0L)
        val frames = taken / o.frameBytes
        val capture = JSONObject()
            .put("method", "usb-driver")
            .put("rate", o.rate).put("channels", o.channels)
            .put("container_bits", o.subslot * 8).put("valid_bits", if (o.dsd) o.subslot * 8 else o.bits)
            .put("dsd", o.dsd).put("kind", o.kind)
            .put("frames", frames).put("seconds", Math.round(frames * 1000.0 / o.rate) / 1000.0)
            .put("asked_seconds", seconds)
            .put("started", startedAt / 1000.0)
            .put("stop_reason", reason)
            .put("interruptions", interruptions)
            .put("player", "Mandarin")
            .put("usb", JSONObject()
                .put("underruns", delta("underruns")).put("errors", delta("errors"))
                .put("dac_rate_set", o.rate).put("feedback", after?.opt("feedback") ?: JSONObject.NULL)
                .put("max_packet", after?.opt("max_packet") ?: JSONObject.NULL))
        for (k in context.keys()) capture.put(k, context.get(k))
        return JSONObject().put("tool", "Mandarin USB ${BuildConfig.VERSION_NAME}").put("capture", capture)
    }

    /** GET /capture: where it is. */
    fun status(): JSONObject = synchronized(lock) {
        val o = stream
        JSONObject().put("state", state).put("reason", why).put("seconds", seconds)
            .put("frames", if (o != null) taken / o.frameBytes else 0)
            .put("rate", o?.rate ?: JSONObject.NULL).put("channels", o?.channels ?: JSONObject.NULL)
            .put("container_bits", o?.let { it.subslot * 8 } ?: JSONObject.NULL).put("kind", o?.kind ?: JSONObject.NULL)
            .put("wav", if (state == "done") "/capture.wav" else JSONObject.NULL)
            .put("sidecar", if (state == "done") "/capture.wav.json" else JSONObject.NULL)
    }
}
