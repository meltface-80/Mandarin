package com.musicd.server.android

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * This device's own DAC (item 432): a music player's — a FiiO R7's ES9068AS, say — played when no DAC is on the USB
 * port. Each track goes to Android's output at its own rate, as 32-bit float (which carries a 16- or 24-bit sample
 * exactly), never resampled, mixed or scaled by the Bridge: the device's own volume sets the level. Whether Android
 * then passes it on untouched is the device's: a music player's firmware does (FiiO's bypasses Android's resampler
 * for every app), a phone's mixes it at its own rate, which is why it is on by itself only on a music player's.
 *
 * What it takes is what Android takes from an app here, asked of Android itself: on Android 10 and 11 (the R7's is
 * 10), 192 kHz at most. Mandarin is told the rates (/dac.json, as a USB DAC's are) and converts anything above them
 * itself, saying so; nothing is converted on the device. DSD isn't offered: Mandarin sends it as PCM.
 *
 * Where the device's own DAC sits on a USB bridge inside and Android lists it as a USB audio device (UsbDac.own), it is
 * played as a DAC on the port is, by Mandarin's driver, Android left out altogether; this is for one that isn't.
 * [outputs] says which outputs Android has and what it says each takes: the evidence, on the Bridge's Settings and in
 * /dac.json, of how far a device goes.
 */
internal object OwnDac {
    /** Makers whose devices are music players, their own DAC the point of them. */
    private val PLAYER_MAKERS = listOf("fiio", "hiby", "ibasso", "shanling", "cayin", "astell", "iriver", "dreamus", "lotoo", "questyle", "hidizs")

    /** The PCM rates Mandarin knows (DacService's), as Android is asked about them. */
    private val RATES = listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000)

    /** The depths Mandarin may send: float carries every one of them exactly. */
    val BITS = listOf(16, 24)

    /** A music player by its maker: a Sony only where it is a Walkman (NW-…), not an Xperia. */
    fun isPlayer(manufacturer: String, model: String): Boolean {
        val m = manufacturer.trim().lowercase()
        if (m == "sony") return model.trim().uppercase().startsWith("NW-")
        return PLAYER_MAKERS.any { m.startsWith(it) }
    }

    /** "FiiO R7": the model, with its maker in front where the model doesn't say it already. */
    fun nameOf(manufacturer: String, model: String): String {
        val maker = manufacturer.trim(); val m = model.trim()
        return when {
            m.isEmpty() -> maker.ifEmpty { "This device" }
            maker.isEmpty() || m.lowercase().startsWith(maker.lowercase()) -> m
            else -> "$maker $m"
        }
    }

    /** What the Now Playing screen and Mandarin call it: "FiiO R7's own DAC". */
    fun name(): String = nameOf(Build.MANUFACTURER ?: "", Build.MODEL ?: "") + "'s own DAC"

    /** Played through when no DAC is on the USB port: as set, else on by itself on a music player's. */
    fun on(c: Context): Boolean = Store.ownDac(c) ?: isPlayer(Build.MANUFACTURER ?: "", Build.MODEL ?: "")

    /** "44.1", "192": a rate in kHz as Mandarin writes it. */
    fun khz(rate: Int): String = if (rate % 1000 == 0) (rate / 1000).toString() else String.format(java.util.Locale.ROOT, "%.1f", rate / 1000.0)

    /** What an output is, in words, by Android's type for it. */
    fun kind(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "headphones"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "headset"
        AudioDeviceInfo.TYPE_LINE_ANALOG -> "line out"
        AudioDeviceInfo.TYPE_LINE_DIGITAL -> "digital out"
        AudioDeviceInfo.TYPE_AUX_LINE -> "aux line"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "USB device"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
        AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB accessory"
        AudioDeviceInfo.TYPE_HDMI -> "HDMI"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth"
        AudioDeviceInfo.TYPE_TELEPHONY -> "telephony"
        else -> "type $type"
    }

    /** Android's outputs here, each with the rates and encodings it says it takes (none said: any). */
    fun outputs(c: Context): JSONArray {
        val a = JSONArray()
        val am = c.getSystemService(AudioManager::class.java) ?: return a
        for (d in runCatching { am.getDevices(AudioManager.GET_DEVICES_OUTPUTS) }.getOrDefault(emptyArray())) {
            if (d.type == AudioDeviceInfo.TYPE_TELEPHONY || d.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) continue
            a.put(JSONObject().put("kind", kind(d.type)).put("name", d.productName?.toString() ?: "")
                .put("rates", JSONArray(d.sampleRates.sorted())).put("encodings", JSONArray(d.encodings.map(::encoding))))
        }
        return a
    }

    private fun encoding(e: Int): String = when (e) {
        AudioFormat.ENCODING_PCM_16BIT -> "pcm16"
        AudioFormat.ENCODING_PCM_FLOAT -> "float"
        AudioFormat.ENCODING_PCM_8BIT -> "pcm8"
        21 -> "pcm24"     // ENCODING_PCM_24BIT_PACKED (Android 12)
        22 -> "pcm32"     // ENCODING_PCM_32BIT (Android 12)
        else -> "enc$e"
    }

    /** The rates [takes] says yes to, in order; one it throws on, no. */
    fun ratesTaken(all: List<Int>, takes: (Int) -> Boolean): List<Int> = all.filter { runCatching { takes(it) }.getOrDefault(false) }

    /** The rates Android takes from an app on this device, stereo float: asked once. */
    val rates: List<Int> by lazy {
        ratesTaken(RATES) { r -> AudioTrack.getMinBufferSize(r, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT) > 0 }
    }
}
