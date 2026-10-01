package com.musicd.server.android

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.util.Log
import org.json.JSONObject
import java.nio.ByteBuffer

/**
 * The app's own USB audio driver (Stage 9.2): a stream to the DAC.
 *
 * Opened for a rate: the streaming alternate setting that takes that rate at
 * the DAC's deepest PCM depth is chosen, the interface claimed from Android's
 * own driver, the DAC's clock set, and the native engine (usb_jni.cc) started
 * on the device node. PCM frames go in through [write] packed to the DAC's
 * subslot; the engine paces them by the DAC's feedback. The DAC's USB volume
 * control, where it has one, is driven here too (a feature unit's volume in
 * 1/256 dB, mapped from a percentage across its range).
 */
object UsbDriver {
    private const val TAG = "UsbDriver"

    /** [kind]: "pcm", "dsd" (native, the DSD alternate setting) or "dop" (DSD over a PCM stream), Stage 9.3. */
    class Open(val device: UsbDevice, val conn: UsbDeviceConnection, val iface: UsbInterface, val stream: UsbDac.Stream,
               val rate: Int, val handle: Long, val info: UsbDac.Info, val kind: String = "pcm") {
        val subslot get() = stream.subslot
        val bits get() = stream.bits
        val channels get() = stream.channels
        val frameBytes get() = stream.channels * stream.subslot
        val dsd get() = kind != "pcm"
        /** The DSD rate as a multiple of 44.1 kHz carried in this stream (0 for PCM). */
        val dsdMultiple get() = when (kind) { "dsd" -> DsdExtractor.multiple(rate * 8 * subslot); "dop" -> DsdExtractor.multiple(rate * 16); else -> 0 }
    }

    @Volatile var current: Open? = null
        private set
    @Volatile var lastError: String? = null
        private set
    /**
     * The DAC's volume starts low. A DAC with a USB volume control comes up
     * wherever it likes (the DragonFly at full), and headphones are on the
     * other end: switching USB direct on, or plugging a DAC in, starts the
     * level at [SAFE_START]; the opens after that (the next track) keep what
     * the slider set in between.
     */
    const val SAFE_START = 10
    @Volatile private var volumePct = SAFE_START
    @Volatile private var muted = false
    private var volumeRange: IntArray? = null   // min, max, res in 1/256 dB (UAC1 and UAC2 alike)
    private var app: Context? = null

    val active: Boolean get() = current != null
    val hasVolume: Boolean get() = current?.info?.volumeControl == true
    /**
     * Fixed volume: the DAC at full, the amplifier for the level. The setting
     * when the user has made one; otherwise fixed for a DAC with no USB
     * volume control, the slider for one with.
     */
    fun fixed(c: Context? = app): Boolean {
        val ctx = c ?: return current?.info?.volumeControl != true
        return Store.usbFixed(ctx, (UsbDac.info()?.volumeControl) != true)
    }
    /** The slider's ceiling, 0–100 (Store `usb_limit`); 100 with fixed volume. */
    fun limit(c: Context? = app): Int = if (fixed(c)) 100 else (c?.let { Store.usbLimit(it) } ?: 100)
    /** The slider drives the level: a stream is open and the volume isn't fixed (the DAC's own control, or software gain). */
    val controlsVolume: Boolean get() = current != null && !fixed()
    /** The level the DAC is driven at, 0–100: full with fixed volume, else the slider within the limit. */
    fun level(): Int = if (fixed()) 100 else minOf(volumePct, limit())
    /**
     * The gain the sink applies, for a DAC with no volume control of its own
     * when the volume isn't fixed: the same loudness curve as [applyVolume],
     * (level/100)³. 1 means bit-perfect: nothing touched.
     */
    fun softwareGain(): Float {
        val o = current ?: return 1f
        if (o.info.volumeControl || o.dsd) return 1f
        if (fixed()) return 1f
        if (muted) return 0f
        val l = level() / 100.0
        return (l * l * l).toFloat()
    }
    /** A settings change (fixed, limit): the DAC's level follows at once. */
    fun settingsChanged() {
        volumePct = volumePct.coerceAtMost(limit())
        current?.let { applyVolume(it.conn, it.info) }
    }
    /** The DAC's volume range as it states it, in dB: [min, max, step]; null when it has none or hasn't said. */
    fun volumeDb(): DoubleArray? = volumeRange?.let { r -> doubleArrayOf(r[0] / 256.0, r[1] / 256.0, r[2] / 256.0) }

    /** "44100/24": what the DAC is being fed, for the badge; "dsd64" native DSD, "dop64" DSD over PCM. */
    fun describe(): String? = current?.let { if (it.dsd) "${it.kind}${it.dsdMultiple}" else "${it.rate}/${it.bits}" }

    /**
     * Can the DAC on the port take this rate — as PCM, or ([dsd]) on its DSD
     * alternate setting with 32- or 16-bit slots? (Null: no DAC, no
     * permission, or not read yet.)
     */
    fun streamFor(info: UsbDac.Info?, rate: Int, dsd: Boolean = false): UsbDac.Stream? {
        if (info == null) return null
        val takes = { s: UsbDac.Stream ->
            (if (dsd) s.dsd && (s.subslot == 4 || s.subslot == 2) else s.pcm) && s.channels == 2 &&
                (s.rates.contains(rate) || (s.continuous != null && rate >= s.continuous[0] && rate <= s.continuous[1]) ||
                (s.rates.isEmpty() && s.continuous == null && (info.clockRates.contains(rate) || info.clockRates.isEmpty())))
        }
        return info.streams.filter(takes).maxByOrNull { it.bits * 10 + it.subslot }
    }

    /**
     * The DSD the DAC can be given, as multiples of 44.1 kHz: natively (its
     * DSD alternate setting at the DSD rate over the slot width) and as DoP
     * (24 bits or more of PCM at a sixteenth of the DSD rate).
     */
    fun dsdCaps(info: UsbDac.Info?): Pair<List<Int>, List<Int>> {
        if (info == null) return Pair(emptyList(), emptyList())
        val native = ArrayList<Int>(); val dop = ArrayList<Int>()
        for (n in listOf(64, 128, 256, 512)) {
            val hz = n * 44100
            val s = streamFor(info, hz / 32, true) ?: streamFor(info, hz / 16, true)?.takeIf { it.subslot == 2 }
            if (s != null && (s.subslot == 4 || s.subslot == 2)) native.add(n)
            val p = streamFor(info, hz / 16)
            if (p != null && p.bits >= 24) dop.add(n)
        }
        return Pair(native, dop)
    }

    /**
     * Open the DAC for [rate]: PCM, or ([kind] "dsd") its DSD alternate
     * setting, or ("dop") PCM carrying DoP. [silence] is what the engine
     * sends when it has nothing (a frame or more: zeros for PCM, DSD silence,
     * DoP frames with their markers). True when the stream is up; false
     * (with [lastError]) when it isn't.
     */
    @Synchronized
    fun open(c: Context, rate: Int, kind: String = "pcm", silence: ByteArray? = null): Boolean {
        close()
        val um = c.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return fail("no USB service")
        val device = UsbDac.device() ?: return fail("no DAC on the port")
        val info = UsbDac.info() ?: return fail("the DAC hasn't been read yet")
        if (!um.hasPermission(device)) return fail("no permission for the DAC")
        val stream = streamFor(info, rate, kind == "dsd") ?: return fail(if (kind == "dsd") "the DAC doesn't take DSD at ${rate / 1000.0} kHz" else "the DAC doesn't take ${rate / 1000.0} kHz")
        val iface = (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == stream.iface && it.alternateSetting == stream.alt }
            ?: (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == stream.iface }
            ?: return fail("streaming interface ${stream.iface} not found")
        val conn = um.openDevice(device) ?: return fail("couldn't open the DAC")
        // Android's own USB audio driver holds the interface; force takes it away.
        if (!conn.claimInterface(iface, true)) { conn.close(); return fail("couldn't claim the streaming interface") }
        val ac = (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == info.controlInterface }
        if (ac != null) conn.claimInterface(ac, true)
        try {
            // The volume first, before the stream is up: never a note at the DAC's own level.
            app = c.applicationContext
            volumePct = startVolume(c)
            muted = false
            readVolumeRange(conn, info)
            if (info.volumeControl) applyVolume(conn, info)
            if (!setRate(conn, info, stream, rate)) Log.w(TAG, "the DAC didn't confirm the rate")
            val fbMax = if (stream.feedback != null) (if (info.speed == "high" || info.speed == "super") 4 else 3) else 0
            val h = nativeOpen(conn.fileDescriptor, stream.iface, stream.alt, stream.endpoint, stream.feedback ?: 0,
                info.speed == "high" || info.speed == "super" || info.speed == "super-plus", stream.interval, 1, stream.maxPacket, fbMax,
                stream.channels * stream.subslot, rate, silence)
            if (h == 0L) { conn.releaseInterface(iface); conn.close(); return fail("the stream couldn't be set up (see the log)") }
            current = Open(device, conn, iface, stream, rate, h, info, kind)
            lastError = null
            Log.i(TAG, "open: ${info.name} at $rate Hz, ${stream.bits}-bit, alt ${stream.alt}, $kind" +
                (if (fixed(c)) ", fixed volume" else ", volume ${level()}% (limit ${limit(c)})" + (if (info.volumeControl) "" else " in software")))
            return true
        } catch (e: Throwable) {
            runCatching { conn.releaseInterface(iface) }; conn.close()
            return fail("couldn't start: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun fail(why: String): Boolean { lastError = why; Log.w(TAG, why); return false }

    /** The DAC's clock, set to [rate]: UAC1 asks the endpoint, UAC2 the clock source. */
    private fun setRate(conn: UsbDeviceConnection, info: UsbDac.Info, s: UsbDac.Stream, rate: Int): Boolean {
        if (info.uac == 2) {
            val clk = info.clocks.firstOrNull() ?: return false
            val idx = (clk shl 8) or info.controlInterface
            val b = byteArrayOf((rate and 0xff).toByte(), ((rate shr 8) and 0xff).toByte(), ((rate shr 16) and 0xff).toByte(), ((rate shr 24) and 0xff).toByte())
            val n = conn.controlTransfer(0x21, 0x01, 0x0100, idx, b, 4, 1000)
            val back = ByteArray(4)
            val m = conn.controlTransfer(0xA1, 0x01, 0x0100, idx, back, 4, 1000)
            val got = if (m == 4) (back[0].toInt() and 0xff) or ((back[1].toInt() and 0xff) shl 8) or ((back[2].toInt() and 0xff) shl 16) or ((back[3].toInt() and 0xff) shl 24) else -1
            return n == 4 && got == rate
        }
        val b = byteArrayOf((rate and 0xff).toByte(), ((rate shr 8) and 0xff).toByte(), ((rate shr 16) and 0xff).toByte())
        val n = conn.controlTransfer(0x22, 0x01, 0x0100, s.endpoint, b, 3, 1000)
        val back = ByteArray(3)
        val m = conn.controlTransfer(0xA2, 0x81, 0x0100, s.endpoint, back, 3, 1000)
        val got = if (m == 3) (back[0].toInt() and 0xff) or ((back[1].toInt() and 0xff) shl 8) or ((back[2].toInt() and 0xff) shl 16) else -1
        return n == 3 && (got == rate || m != 3)
    }

    // ------------------------------------------------------------- volume

    private fun s16(b: ByteArray) = ((b[0].toInt() and 0xff) or ((b[1].toInt() and 0xff) shl 8)).toShort().toInt()

    private fun readVolumeRange(conn: UsbDeviceConnection, info: UsbDac.Info) {
        volumeRange = null
        if (!info.volumeControl || info.featureUnit < 0) return
        val idx = (info.featureUnit shl 8) or info.controlInterface
        try {
            if (info.uac == 2) {
                val head = ByteArray(2)
                if (conn.controlTransfer(0xA1, 0x02, 0x0200, idx, head, 2, 1000) != 2) return
                val n = (head[0].toInt() and 0xff) or ((head[1].toInt() and 0xff) shl 8)
                val buf = ByteArray(2 + 6 * n)
                if (conn.controlTransfer(0xA1, 0x02, 0x0200, idx, buf, buf.size, 1000) < 8) return
                volumeRange = intArrayOf(s16(buf.copyOfRange(2, 4)), s16(buf.copyOfRange(4, 6)), s16(buf.copyOfRange(6, 8)))
            } else {
                val mn = ByteArray(2); val mx = ByteArray(2); val rs = ByteArray(2)
                if (conn.controlTransfer(0xA1, 0x82, 0x0200, idx, mn, 2, 1000) != 2) return
                if (conn.controlTransfer(0xA1, 0x83, 0x0200, idx, mx, 2, 1000) != 2) return
                val r = if (conn.controlTransfer(0xA1, 0x84, 0x0200, idx, rs, 2, 1000) == 2) s16(rs) else 256
                volumeRange = intArrayOf(s16(mn), s16(mx), if (r > 0) r else 256)
            }
        } catch (e: Exception) { Log.w(TAG, "volume range", e) }
    }

    /** Where the volume starts on an open: what the slider set since direct went on, else [SAFE_START]. */
    private fun startVolume(c: Context): Int {
        val kept = Store.usbVolume(c)
        val lim = Store.usbLimit(c)
        return (if (kept in 0..100) kept else SAFE_START).coerceAtMost(lim)
    }

    /** USB direct switched on, or a DAC plugged in: the next open starts at [SAFE_START] again. */
    fun forgetVolume(c: Context) { Store.setUsbVolume(c, -1); volumePct = SAFE_START }

    /** The slider, 0–100, onto the level (a loudness curve, see [applyVolume]), no higher than the limit. Remembered for the next open. */
    fun setVolume(pct: Int) {
        if (fixed()) return
        volumePct = pct.coerceIn(0, limit())
        app?.let { Store.setUsbVolume(it, volumePct) }
        current?.let { applyVolume(it.conn, it.info) }
    }
    /** The phone's volume buttons: a step of 5. */
    fun stepVolume(up: Boolean) = setVolume(volumePct + (if (up) 5 else -5))
    fun setMute(on: Boolean) { muted = on; current?.let { applyVolume(it.conn, it.info) } }
    fun volume(): Int = if (fixed()) 100 else volumePct
    fun isMuted(): Boolean = muted

    private fun applyVolume(conn: UsbDeviceConnection, info: UsbDac.Info) {
        if (!info.volumeControl || info.featureUnit < 0) return
        val idx = (info.featureUnit shl 8) or info.controlInterface
        val range = volumeRange ?: intArrayOf(-64 * 256, 0, 256)
        val pct = level()
        // A loudness curve, not a straight line across the DAC's range (often
        // -127 dB to 0): 60·log10(pct/100) dB below the top, so 50% is -18 dB,
        // 20% is -42 dB and 10% is -60 dB, whatever the DAC states. 0% is its floor.
        var v = if (pct <= 0) range[0] else range[1] + Math.round(256.0 * 60.0 * Math.log10(pct / 100.0)).toInt()
        if (v < range[0]) v = range[0]
        if (range[2] > 0 && v > range[0]) v = range[0] + ((v - range[0]) / range[2]) * range[2]
        val b = byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte())
        try {
            val n = conn.controlTransfer(0x21, 0x01, 0x0200, idx, b, 2, 500)
            if (n != 2) Log.w(TAG, "the DAC didn't take the volume ($pct% = ${v / 256.0} dB)")
            if (info.muteControl) conn.controlTransfer(0x21, 0x01, 0x0100, idx, byteArrayOf(if (muted) 1 else 0), 1, 500)
        } catch (e: Exception) { Log.w(TAG, "volume", e) }
    }

    // ------------------------------------------------------------- stream

    fun play(): Boolean = current?.let { nativePlay(it.handle) } ?: false
    fun pause() { current?.let { nativePause(it.handle) } }
    fun write(buf: ByteBuffer, off: Int, len: Int): Int = current?.let { nativeWrite(it.handle, buf, off, len) } ?: -1
    fun free(): Int = current?.let { nativeFree(it.handle) } ?: 0
    fun pending(): Long = current?.let { nativePending(it.handle) } ?: 0
    fun played(): Long = current?.let { nativePlayed(it.handle) } ?: 0
    fun drain() { current?.let { nativeDrain(it.handle) } }
    fun flush() { current?.let { nativeFlush(it.handle) } }
    fun dead(): Boolean = current?.let { nativeDead(it.handle) } ?: false

    @Synchronized
    fun close() {
        val o = current ?: return
        current = null
        runCatching { nativeClose(o.handle) }
        runCatching { o.conn.releaseInterface(o.iface) }
        runCatching { o.conn.close() }
        Log.i(TAG, "closed")
    }

    fun stats(): JSONObject? = current?.let { runCatching { JSONObject(nativeStats(it.handle)) }.getOrNull() }

    init { runCatching { System.loadLibrary("mandarinusb") }.onFailure { Log.w(TAG, "no native usb library", it) } }
    @JvmStatic private external fun nativeOpen(fd: Int, iface: Int, alt: Int, ep: Int, fbEp: Int, highSpeed: Boolean, interval: Int, fbInterval: Int,
                                               maxPacket: Int, fbMaxPacket: Int, frameBytes: Int, rate: Int, silence: ByteArray?): Long
    @JvmStatic private external fun nativePlay(h: Long): Boolean
    @JvmStatic private external fun nativePause(h: Long)
    @JvmStatic private external fun nativeWrite(h: Long, buf: ByteBuffer, off: Int, len: Int): Int
    @JvmStatic private external fun nativeFree(h: Long): Int
    @JvmStatic private external fun nativePending(h: Long): Long
    @JvmStatic private external fun nativePlayed(h: Long): Long
    @JvmStatic private external fun nativeDrain(h: Long)
    @JvmStatic private external fun nativeFlush(h: Long)
    @JvmStatic private external fun nativeClose(h: Long)
    @JvmStatic private external fun nativeStats(h: Long): String
    @JvmStatic private external fun nativeDead(h: Long): Boolean
}
