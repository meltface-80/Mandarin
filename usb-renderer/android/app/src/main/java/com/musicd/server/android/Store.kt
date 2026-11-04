package com.musicd.server.android

import android.content.Context
import android.os.Build
import java.util.UUID

/**
 * What the app remembers: the renderer's name and identity on the network,
 * what keeps the device awake, and the USB settings Mandarin's driver reads.
 *
 * The USB functions are the ones Mandarin's UsbDriver, UsbDac and
 * UsbAudioSink call (Mandarin's android/app/…), with the same names and
 * meanings, so those files build here unchanged. The one difference: USB
 * direct is always on. This app plays through the driver or not at all.
 */
object Store {
    private const val PREFS = "mandarin-usb"
    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ------------------------------------------------------------- renderer

    /** The port the renderer answers on (its description, control, events and dac.json). */
    const val PORT = 49494

    /** What the renderer is called on the network (UPnP friendlyName): what Mandarin's speaker list shows. */
    fun friendlyName(c: Context): String = prefs(c).getString("friendly_name", null)?.takeIf { it.isNotBlank() } ?: defaultName()
    fun setFriendlyName(c: Context, name: String) { prefs(c).edit().putString("friendly_name", name.trim()).apply() }

    fun defaultName(): String {
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = Build.MODEL
        return (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model") + " USB"
    }

    /** The renderer's UDN ("uuid:…"), made once and kept: the id Mandarin knows the device by across restarts and addresses. */
    @Synchronized
    fun udn(c: Context): String {
        val p = prefs(c)
        p.getString("udn", null)?.let { return it }
        val u = "uuid:" + UUID.randomUUID().toString()
        p.edit().putString("udn", u).apply()
        return u
    }

    // ------------------------------------------------------------- the device

    /** The screen stays on while the app is in front. The CPU and Wi-Fi are kept awake regardless, while the player runs. */
    fun keepScreenOn(c: Context): Boolean = prefs(c).getBoolean("keep_screen_on", false)
    fun setKeepScreenOn(c: Context, on: Boolean) { prefs(c).edit().putBoolean("keep_screen_on", on).apply() }

    /** The player starts when the device does. */
    fun startOnBoot(c: Context): Boolean = prefs(c).getBoolean("start_on_boot", true)
    fun setStartOnBoot(c: Context, on: Boolean) { prefs(c).edit().putBoolean("start_on_boot", on).apply() }

    // --------------------------------------------------- USB (Mandarin's driver)

    /** Always: the app plays through the driver alone (Mandarin's switch, Settings → Audio Devices → USB direct). */
    @Suppress("UNUSED_PARAMETER")
    fun usbDirect(c: Context): Boolean = true
    @Suppress("UNUSED_PARAMETER")
    fun setUsbDirect(c: Context, on: Boolean) {}
    /** The DAC's USB volume as last set (0–100), or -1 (forgotten): the driver then starts low. */
    fun usbVolume(c: Context): Int = prefs(c).getInt("usb_volume", -1)
    fun setUsbVolume(c: Context, pct: Int) { prefs(c).edit().putInt("usb_volume", if (pct < 0) -1 else pct.coerceIn(0, 100)).apply() }
    /** Fixed volume: the DAC at full, the amplifier for the level. Unset, it follows the DAC: fixed for one with no USB volume control. */
    fun usbFixed(c: Context, default: Boolean): Boolean = prefs(c).let { if (it.contains("usb_fixed")) it.getBoolean("usb_fixed", default) else default }
    fun setUsbFixed(c: Context, on: Boolean) { prefs(c).edit().putBoolean("usb_fixed", on).apply() }
    /** How DSD goes to the DAC: native, native_le (each 32-bit word reversed), dop, or pcm (converted on the server). */
    fun usbDsd(c: Context): String = prefs(c).getString("usb_dsd", "native") ?: "native"
    fun setUsbDsd(c: Context, mode: String) { prefs(c).edit().putString("usb_dsd", if (mode in listOf("native", "native_le", "dop", "pcm")) mode else "native").apply() }
    /** The USB audio device to play through, by UsbDac.key (vendor:product), where there is more than one (a FiiO R7's own DAC is one); null for the driver's own choice. */
    fun usbDevice(c: Context): String? = prefs(c).getString("usb_device", null)
    fun setUsbDevice(c: Context, key: String?) { prefs(c).edit().apply { if (key.isNullOrBlank()) remove("usb_device") else putString("usb_device", key) }.apply() }
    /** The most the USB volume may be set to (1–100). */
    fun usbLimit(c: Context): Int = prefs(c).getInt("usb_limit", 80).coerceIn(1, 100)
    fun setUsbLimit(c: Context, pct: Int) { prefs(c).edit().putInt("usb_limit", pct.coerceIn(1, 100)).apply() }
}
