package com.musicd.server.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONObject

/**
 * Mandarin Bridge updated from Mandarin's Settings → Updates (item 291), by the browser (item 297). Asked with a
 * release's tag (POST /update {tag}: "test-bridge" or "mandarin-bridge-v…", never an address: the Bridge's port has no
 * sign-in), it shows a notification on the device; a tap opens that release's mandarin-bridge.apk in the browser,
 * which downloads it, and Android's installer installs it when the person holding the device says so. Android refuses
 * an APK signed by any other key than the one installed. Once installed, the Bridge starts again by itself
 * (BootReceiver, MY_PACKAGE_REPLACED).
 *
 * It installed the update itself from 0.2.0 (the package installer, no question asked on Android 12 and later): an
 * app that may install apps without asking is what Google Play Protect calls harmful, and it said so of 0.2.1. So the
 * Bridge holds no permission to install apps, and downloads nothing of its own: the browser does both, as it did
 * before there were updates from Mandarin.
 */
object Updater {
    private const val REPO = "meltface-80/Mandarin"
    private const val CHANNEL = "update"
    private const val NOTIFICATION = 2
    private val TAG = Regex("^(test-bridge|mandarin-bridge-v\\d+\\.\\d+\\.\\d+(-[A-Za-z0-9.]+)?)$")

    @Volatile private var state = "idle"
    @Volatile private var says = ""

    /** Where it is: idle, or needs-you (the notification is waiting on the device); what it says. */
    fun json(): JSONObject = JSONObject().put("state", state).put("says", says).put("to", JSONObject.NULL)

    /** The address of the release [tag]'s build for this app. */
    fun download(tag: String): String = "https://github.com/$REPO/releases/download/$tag/mandarin-bridge.apk"

    /** The release [tag] offered on the device, its notification shown: null, or why it can't be. */
    @Synchronized fun start(c: Context, tag: String): String? {
        if (!TAG.matches(tag)) return "not a release of Mandarin Bridge's: $tag"
        notify(c.applicationContext, "Update Mandarin Bridge", "Tap to download the update, then install it.",
            Intent(Intent.ACTION_VIEW, Uri.parse(download(tag))))
        state = "needs-you"
        says = "On the device: tap Mandarin Bridge's notification to download the update, then install it"
        return null
    }

    /** A notification on the device that opens [open] when tapped: what the update needs of the person holding it. */
    private fun notify(c: Context, title: String, text: String, open: Intent) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_HIGH))
        val tap = PendingIntent.getActivity(c, 0, open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0))
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CHANNEL) else Notification.Builder(c)
        nm.notify(NOTIFICATION, b.setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(text)
            .setContentIntent(tap).setAutoCancel(true).build())
    }
}
