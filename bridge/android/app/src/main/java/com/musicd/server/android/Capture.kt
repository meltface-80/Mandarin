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
 * it sample by sample with what it sent. Made only when asked, never by itself.
 *
 * The bytes are those the USB driver's stream took (UsbDriver.tap), after every conversion the app makes: the very
 * words the isochronous transfers carry to the DAC. They are written as SQ-tool writes a capture of its own: a WAV
 * whose container is the DAC's slot (16, 24 or 32 bits) and whose valid bits are the DAC format's, beside a sidecar
 * (`.wav.json`) saying how it was made — the format, native DSD or DoP, where the stream was flushed (a seek), the
 * USB driver's underruns and errors while it ran, the DAC, and the track that was playing.
 *
 *   POST   /capture {"seconds": 30}   start, from the next byte the driver takes (409 while one runs); up to two minutes
 *   POST   /capture {"seconds": 221, "part": 60, "after_flush": true}
 *                                     the whole of a track (item 286): from the first byte after the stream is next
 *                                     flushed or opened afresh (the track the server plays again from its start), kept
 *                                     in parts of [part] seconds, each begun on the byte after the last part's
 *   GET    /capture                   where it is: idle, armed (no stream yet), recording, done, failed; and "parts",
 *                                     the parts done and not yet let go
 *   GET    /capture.wav, .wav.json    a recording in one part, once done; its sidecar
 *   GET    /capture/N.wav, .wav.json  part N, once done
 *   DELETE /capture/N                 part N let go (fetched)
 *   DELETE /capture                   stop; what was recorded is kept and finished
 *
 * The stream changing format (another rate, DSD after PCM) ends it: a WAV has one format. [about] says what is
 * known when it starts (the DAC, the track and where in it), read on the server's thread.
 */
class Capture(private val dir: File, private val about: () -> JSONObject) : UsbDriver.Tap {
    companion object {
        private const val TAG = "Capture"
        const val MAX_SECONDS = 120
        const val MAX_WHOLE = 6 * 3600                // a recording in parts: the longest track
        private const val BEHIND_MAX = 64L shl 20   // bytes taken but not yet on disk: more, and the disk can't keep up
        private const val WAITING_MAX = 3           // parts done but not fetched: more, and the server isn't collecting them
    }

    val wav = File(dir, "capture.wav")
    val sidecar = File(dir, "capture.wav.json")
    fun partWav(n: Int) = File(dir, "capture-$n.wav")
    fun partSidecar(n: Int) = File(dir, "capture-$n.wav.json")
    private val disk = Executors.newSingleThreadExecutor { r -> Thread(r, "capture").apply { isDaemon = true } }
    private val behind = AtomicLong()
    private val lock = Any()

    @Volatile private var state = "idle"
    private var why = ""
    private var seconds = 0
    private var partSeconds = 0                     // 0: one file (capture.wav), as an older server asks
    private var afterFlush = false
    private var armedOn: UsbDriver.Open? = null      // the stream when armed: a new one begins it, as a flush does
    private var flushedSinceArmed = false
    private var context = JSONObject()
    private var stream: UsbDriver.Open? = null
    private var file: RandomAccessFile? = null
    private var target = 0L                          // the whole recording's bytes
    private var taken = 0L
    private var partN = 0
    private var partTarget = 0L
    private var partTaken = 0L
    private var startedAt = 0L
    private var before: JSONObject? = null
    private var interruptions = JSONArray()
    private val waiting = sortedSetOf<Int>()          // parts done, not yet let go

    /** Starts one: false while one is armed or recording. */
    fun start(secs: Int, part: Int = 0, flush: Boolean = false): Boolean {
        if (state == "armed" || state == "recording" || state == "finishing") return false
        // Read before the lock: it waits on the main thread, and the stream's thread waits on the lock.
        val ctx = runCatching(about).getOrElse { JSONObject().put("error", it.message) }
        synchronized(lock) {
            if (state == "armed" || state == "recording" || state == "finishing") return false
            partSeconds = if (part > 0) part.coerceIn(1, MAX_SECONDS) else 0
            seconds = secs.coerceIn(1, if (partSeconds > 0) MAX_WHOLE else MAX_SECONDS)
            afterFlush = flush; flushedSinceArmed = false; armedOn = UsbDriver.current
            context = ctx
            why = ""; taken = 0; target = 0; partN = 0; partTaken = 0; partTarget = 0; stream = null; before = null; behind.set(0)
            interruptions = JSONArray()
            dir.mkdirs()
            dir.listFiles()?.filter { it.name.startsWith("capture") }?.forEach { it.delete() }
            waiting.clear()
            state = "armed"
            UsbDriver.tap = this
            Log.i(TAG, "armed for $seconds s" + (if (partSeconds > 0) " in parts of $partSeconds s" else "") + (if (afterFlush) ", from the next flush" else ""))
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

    /** Part [n] let go, once fetched. */
    fun drop(n: Int): Boolean = synchronized(lock) {
        val had = waiting.remove(n)
        if (had) { partWav(n).delete(); partSidecar(n).delete() }
        had
    }

    override fun took(buf: ByteBuffer, off: Int, len: Int) {
        synchronized(lock) {
            val o = UsbDriver.current ?: return
            if (state == "armed") {
                // From the stream played again from its start: its flush, or a stream opened afresh.
                if (afterFlush && !flushedSinceArmed && o === armedOn) return
                begin(o) ?: return
            }
            if (state != "recording") return
            if (o !== stream) { finish("the stream changed (another rate or format)"); return }
            var at = off
            var left = minOf(len.toLong(), target - taken).toInt()
            while (left > 0 && state == "recording") {
                val n = minOf(left.toLong(), partTarget - partTaken).toInt()
                if (behind.addAndGet(n.toLong()) > BEHIND_MAX) { fail("the recording couldn't be written fast enough"); return }
                val bytes = ByteArray(n)
                buf.duplicate().apply { position(at) }.get(bytes)
                val f = file
                disk.execute { runCatching { f?.write(bytes) }.onFailure { fail("couldn't write: ${it.message}") }; behind.addAndGet(-n.toLong()) }
                taken += n; partTaken += n; at += n; left -= n
                if (taken >= target) { finish("done"); return }
                // A part full: the next begun on the very next byte, nothing between them.
                if (partTaken >= partTarget) { close("part"); if (!open(o)) return }
            }
        }
    }

    override fun flushed() {
        synchronized(lock) {
            if (state == "armed") { flushedSinceArmed = true; return }
            val o = stream ?: return
            if (state != "recording" || taken == 0L) return
            // A second flush within its first second (a restart flushes more than once): begun again, from it. The
            // same file, emptied on the disk's thread behind the bytes already handed to it.
            if (afterFlush && partN == 1 && taken < o.rate.toLong() * o.frameBytes) {
                val f = file
                val head = header(o, 0)
                disk.execute { runCatching { f?.apply { setLength(0); seek(0); write(head) } }.onFailure { fail("couldn't begin again: ${it.message}") } }
                taken = 0; partTaken = 0; startedAt = System.currentTimeMillis(); before = UsbDriver.stats(); interruptions = JSONArray()
                return
            }
            val frame = partTaken / o.frameBytes
            interruptions.put(JSONObject().put("frame", frame).put("seconds", Math.round(frame * 1000.0 / o.rate) / 1000.0).put("why", "flush"))
        }
    }

    /** The first byte: the format fixed, the first part opened. Null when it can't be (a refusal is a failure). */
    private fun begin(o: UsbDriver.Open): Unit? {
        stream = o; target = o.rate.toLong() * o.frameBytes * seconds; taken = 0; partN = 0
        startedAt = System.currentTimeMillis()
        if (!open(o)) return null
        state = "recording"
        Log.i(TAG, "recording ${o.rate} Hz, ${o.channels} × ${o.subslot * 8}-bit (${o.kind}) for $seconds s")
        return Unit
    }

    /** The next part's file opened (lock held): false, and failed, where it can't be. */
    private fun open(o: UsbDriver.Open): Boolean {
        if (partSeconds > 0 && waiting.size >= WAITING_MAX) { fail("the server isn't collecting the recording"); return false }
        partN++
        partTarget = if (partSeconds > 0) o.rate.toLong() * o.frameBytes * partSeconds else target
        partTaken = 0
        val need = minOf(partTarget, target - taken)
        if (dir.usableSpace < need + (64L shl 20)) { fail("not enough space for ${need shr 20} MB"); return false }
        try { file = RandomAccessFile(partFile(partN), "rw").apply { setLength(0); write(header(o, 0)) } }
        catch (e: Exception) { fail("couldn't open the file: ${e.message}"); return false }
        before = UsbDriver.stats()
        interruptions = JSONArray()
        return true
    }

    private fun partFile(n: Int) = File(dir, if (partSeconds > 0) "capture-$n.wav.part" else "capture.wav.part")

    /** The part being written finished (lock held): its header's lengths written, its sidecar beside it. */
    private fun close(reason: String) {
        val o = stream ?: return
        val f = file
        val n = partN
        val bytes = partTaken
        val first = (taken - partTaken) / o.frameBytes
        val meta = sidecarJson(o, reason, UsbDriver.stats(), n, first, bytes)
        val done = if (partSeconds > 0) partWav(n) else wav
        val side = if (partSeconds > 0) partSidecar(n) else sidecar
        file = null
        disk.execute {
            try {
                f?.apply { seek(0); write(header(o, bytes)); close() }
                partFile(n).renameTo(done)
                side.writeText(meta.toString(2))
                synchronized(lock) {
                    if (partSeconds > 0) waiting.add(n)
                    if (state == "finishing" && reason != "part") state = "done"
                }
                Log.i(TAG, "part $n done: ${bytes / o.frameBytes} frames ($reason)")
            } catch (e: Exception) { fail("couldn't finish: ${e.message}") }
        }
    }

    /** Ends it (lock held): the last part finished. */
    private fun finish(reason: String) {
        UsbDriver.tap = null
        if (stream == null) { state = "idle"; return }
        why = reason
        state = "finishing"
        close(reason)
    }

    private fun fail(reason: String) {
        synchronized(lock) {
            UsbDriver.tap = null
            why = reason; state = "failed"
            runCatching { file?.close() }; if (partN > 0) partFile(partN).delete()
            Log.w(TAG, reason)
        }
    }

    private fun header(o: UsbDriver.Open, data: Long): ByteArray =
        CaptureWav.header(o.rate, o.channels, o.subslot, if (o.dsd) o.subslot * 8 else o.bits, data)

    private fun sidecarJson(o: UsbDriver.Open, reason: String, after: JSONObject?, n: Int, first: Long, bytes: Long): JSONObject {
        // Never below nothing: a stream opened afresh starts the driver's counts again.
        fun delta(k: String) = maxOf(0L, (after?.optLong(k) ?: 0L) - (before?.optLong(k) ?: 0L))
        val frames = bytes / o.frameBytes
        val capture = JSONObject()
            .put("method", "usb-driver")
            .put("rate", o.rate).put("channels", o.channels)
            .put("container_bits", o.subslot * 8).put("valid_bits", if (o.dsd) o.subslot * 8 else o.bits)
            .put("dsd", o.dsd).put("kind", o.kind)
            .put("frames", frames).put("seconds", Math.round(frames * 1000.0 / o.rate) / 1000.0)
            .put("asked_seconds", seconds)
            .put("part", n).put("first_frame", first)
            .put("started", startedAt / 1000.0)
            .put("stop_reason", reason)
            .put("interruptions", interruptions)
            .put("player", "Mandarin")
            .put("usb", JSONObject()
                .put("underruns", delta("underruns")).put("errors", delta("errors"))
                .put("dac_rate_set", o.rate).put("feedback", after?.opt("feedback") ?: JSONObject.NULL)
                .put("max_packet", after?.opt("max_packet") ?: JSONObject.NULL))
        for (k in context.keys()) capture.put(k, context.get(k))
        return JSONObject().put("tool", "Mandarin Bridge ${BuildConfig.VERSION_NAME}").put("capture", capture)
    }

    /** GET /capture: where it is. */
    fun status(): JSONObject = synchronized(lock) {
        val o = stream
        val parts = JSONArray()
        for (n in waiting) {
            val frames = runCatching { JSONObject(partSidecar(n).readText()).getJSONObject("capture").optLong("frames") }.getOrDefault(0L)
            parts.put(JSONObject().put("n", n).put("wav", "/capture/$n.wav").put("sidecar", "/capture/$n.wav.json").put("frames", frames))
        }
        JSONObject().put("state", state).put("reason", why).put("seconds", seconds).put("part_seconds", partSeconds)
            .put("frames", if (o != null) taken / o.frameBytes else 0)
            .put("rate", o?.rate ?: JSONObject.NULL).put("channels", o?.channels ?: JSONObject.NULL)
            .put("container_bits", o?.let { it.subslot * 8 } ?: JSONObject.NULL).put("kind", o?.kind ?: JSONObject.NULL)
            .put("wav", if (state == "done" && partSeconds == 0) "/capture.wav" else JSONObject.NULL)
            .put("sidecar", if (state == "done" && partSeconds == 0) "/capture.wav.json" else JSONObject.NULL)
            .put("parts", parts)
    }
}
