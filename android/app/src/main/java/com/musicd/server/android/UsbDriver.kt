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

    class Open(val device: UsbDevice, val conn: UsbDeviceConnection, val iface: UsbInterface, val stream: UsbDac.Stream,
               val rate: Int, val handle: Long, val info: UsbDac.Info) {
        val subslot get() = stream.subslot
        val bits get() = stream.bits
        val channels get() = stream.channels
        val frameBytes get() = stream.channels * stream.subslot
    }

    @Volatile var current: Open? = null
        private set
    @Volatile var lastError: String? = null
        private set
    @Volatile private var volumePct = 100
    @Volatile private var muted = false
    private var volumeRange: IntArray? = null   // min, max, res in 1/256 dB (UAC1 and UAC2 alike)

    val active: Boolean get() = current != null
    val hasVolume: Boolean get() = current?.info?.volumeControl == true

    /** "44100/24": what the DAC is being fed, for the badge. */
    fun describe(): String? = current?.let { "${it.rate}/${it.bits}" }

    /** Can the DAC on the port take this rate? (Null: no DAC, no permission, or not read yet.) */
    fun streamFor(info: UsbDac.Info?, rate: Int): UsbDac.Stream? {
        if (info == null) return null
        val takes = { s: UsbDac.Stream ->
            s.pcm && s.channels == 2 && (s.rates.contains(rate) || (s.continuous != null && rate >= s.continuous[0] && rate <= s.continuous[1]) ||
                (s.rates.isEmpty() && s.continuous == null && (info.clockRates.contains(rate) || info.clockRates.isEmpty())))
        }
        return info.streams.filter(takes).maxByOrNull { it.bits * 10 + it.subslot }
    }

    /** Open the DAC for [rate]. True when the stream is up; false (with [lastError]) when it isn't. */
    @Synchronized
    fun open(c: Context, rate: Int): Boolean {
        close()
        val um = c.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return fail("no USB service")
        val device = UsbDac.device() ?: return fail("no DAC on the port")
        val info = UsbDac.info() ?: return fail("the DAC hasn't been read yet")
        if (!um.hasPermission(device)) return fail("no permission for the DAC")
        val stream = streamFor(info, rate) ?: return fail("the DAC doesn't take ${rate / 1000.0} kHz")
        val iface = (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == stream.iface && it.alternateSetting == stream.alt }
            ?: (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == stream.iface }
            ?: return fail("streaming interface ${stream.iface} not found")
        val conn = um.openDevice(device) ?: return fail("couldn't open the DAC")
        // Android's own USB audio driver holds the interface; force takes it away.
        if (!conn.claimInterface(iface, true)) { conn.close(); return fail("couldn't claim the streaming interface") }
        val ac = (0 until device.interfaceCount).map { device.getInterface(it) }.firstOrNull { it.id == info.controlInterface }
        if (ac != null) conn.claimInterface(ac, true)
        try {
            if (!setRate(conn, info, stream, rate)) Log.w(TAG, "the DAC didn't confirm the rate")
            val fbMax = if (stream.feedback != null) (if (info.speed == "high" || info.speed == "super") 4 else 3) else 0
            val h = nativeOpen(conn.fileDescriptor, stream.iface, stream.alt, stream.endpoint, stream.feedback ?: 0,
                info.speed == "high" || info.speed == "super" || info.speed == "super-plus", stream.interval, 1, stream.maxPacket, fbMax,
                stream.channels * stream.subslot, rate)
            if (h == 0L) { conn.releaseInterface(iface); conn.close(); return fail("the stream couldn't be set up (see the log)") }
            current = Open(device, conn, iface, stream, rate, h, info)
            readVolumeRange(conn, info)
            if (info.volumeControl) applyVolume()
            lastError = null
            Log.i(TAG, "open: ${info.name} at $rate Hz, ${stream.bits}-bit, alt ${stream.alt}")
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

    /** The slider, 0–100, onto the DAC's own control: a straight line in dB across its range. */
    fun setVolume(pct: Int) { volumePct = pct.coerceIn(0, 100); applyVolume() }
    fun setMute(on: Boolean) { muted = on; applyVolume() }
    fun volume(): Int = volumePct
    fun isMuted(): Boolean = muted

    private fun applyVolume() {
        val o = current ?: return
        val info = o.info
        if (!info.volumeControl || info.featureUnit < 0) return
        val idx = (info.featureUnit shl 8) or info.controlInterface
        val range = volumeRange ?: intArrayOf(-64 * 256, 0, 256)
        val span = range[1] - range[0]
        var v = range[0] + Math.round(span * volumePct / 100.0).toInt()
        if (range[2] > 0) v = range[0] + ((v - range[0]) / range[2]) * range[2]
        if (volumePct == 0) v = range[0]
        val b = byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte())
        try {
            o.conn.controlTransfer(0x21, 0x01, 0x0200, idx, b, 2, 500)
            if (info.muteControl) o.conn.controlTransfer(0x21, 0x01, 0x0100, idx, byteArrayOf(if (muted) 1 else 0), 1, 500)
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
                                               maxPacket: Int, fbMaxPacket: Int, frameBytes: Int, rate: Int): Long
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
