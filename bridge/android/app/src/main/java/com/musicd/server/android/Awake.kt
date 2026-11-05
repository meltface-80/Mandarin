package com.musicd.server.android

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log

/**
 * The device kept awake while the player runs: a partial wake lock (the CPU
 * never suspends, whatever the screen does) and a high-performance Wi-Fi
 * lock (the radio never dozes), held from the service's start to its stop —
 * not only while a track plays, so the server's commands are always
 * answered and the DAC is always ready. A FiiO R7 on a desk is a streamer,
 * not a phone: it should never go to sleep on its own.
 */
object Awake {
    private const val TAG = "Awake"
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    @Synchronized
    fun hold(c: Context) {
        if (wake == null) {
            val pm = c.getSystemService(Context.POWER_SERVICE) as PowerManager
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MandarinBridge:player").apply { setReferenceCounted(false); acquire() }
        }
        if (wifi == null) {
            val wm = c.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            @Suppress("DEPRECATION")
            wifi = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MandarinBridge:wifi")?.apply { setReferenceCounted(false); acquire() }
        }
        Log.i(TAG, "held")
    }

    @Synchronized
    fun release() {
        runCatching { wake?.takeIf { it.isHeld }?.release() }
        runCatching { wifi?.takeIf { it.isHeld }?.release() }
        wake = null; wifi = null
        Log.i(TAG, "released")
    }

    @Synchronized
    fun held(): Boolean = wake?.isHeld == true
}
