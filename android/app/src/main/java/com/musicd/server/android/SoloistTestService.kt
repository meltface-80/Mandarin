package com.musicd.server.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * The Soloist test build's keep-alive (bug list item 148, [SoloistPhone]): while Soloist runs, the app is in the
 * foreground as a media player, so Android neither freezes nor ends it (Soloist is the app's child process) when the
 * screen goes off; and the Wi-Fi lets multicast in, so the Spotify app can find it. Ends itself when Soloist does.
 */
class SoloistTestService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var multicast: WifiManager.MulticastLock? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Soloist test", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, SoloistTestActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_tile_random).setContentTitle("Soloist test")
            .setContentText("Soloist is running on this phone").setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(ID, n)
        if (multicast == null) multicast = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createMulticastLock("soloist-test").apply { setReferenceCounted(false); acquire() }
        if (wake == null) wake = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mandarin:soloist-test").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        main.removeCallbacksAndMessages(null)
        main.postDelayed(::watch, 5_000)
        return START_NOT_STICKY
    }

    private fun watch() {
        if (SoloistPhoneRun.running()) { main.postDelayed(::watch, 3_000); return }
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        runCatching { multicast?.release() }
        runCatching { wake?.release() }
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "soloist_test"
        private const val ID = 4148
        fun start(c: Context) = runCatching { c.startForegroundService(Intent(c, SoloistTestService::class.java)) }
    }
}
