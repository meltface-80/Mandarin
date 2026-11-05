package com.musicd.server.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Mandarin Bridge updated from Mandarin's Settings → Updates (item 291). Asked with a release's tag (POST /update
 * {tag}: "test-bridge" or "mandarin-bridge-v…", never an address: the Bridge's port has no sign-in), it fetches that
 * release of Mandarin's from GitHub itself, mandarin-bridge.apk and its sidecar (.json: the build and its SHA-256),
 * checks the one against the other, and installs it over itself with the package installer. Android itself refuses
 * an APK signed by any other key than the one installed.
 *
 * Android asks on the device the first time: to let Mandarin Bridge install apps, and to confirm the install (a
 * notification, tapped). From then on, the Bridge being the installer of its own last version, Android 12 and later
 * install its updates without asking. Once installed, the Bridge starts again by itself (BootReceiver,
 * MY_PACKAGE_REPLACED).
 */
object Updater {
    private const val API = "https://api.github.com"
    private const val REPO = "meltface-80/Mandarin"
    private const val CHANNEL = "update"
    private const val NOTIFICATION = 2
    private val TAG = Regex("^(test-bridge|mandarin-bridge-v\\d+\\.\\d+\\.\\d+(-[A-Za-z0-9.]+)?)$")

    @Volatile private var state = "idle"
    @Volatile private var says = ""
    @Volatile private var to = ""

    /** Where it is: idle, downloading, installing, needs-you, failed; what it says; the build it goes to. */
    fun json(): JSONObject = JSONObject().put("state", state).put("says", says).put("to", if (to.isEmpty()) JSONObject.NULL else to)

    /** The release [tag] fetched and installed, in the background: null, or why it can't begin. */
    @Synchronized fun start(c: Context, tag: String): String? {
        if (!TAG.matches(tag)) return "not a release of Mandarin Bridge's: $tag"
        if (state == "downloading" || state == "installing") return "an update is already under way"
        say("downloading", "Downloading the update")
        to = ""
        val app = c.applicationContext
        Thread({ go(app, tag) }, "update").start()
        return null
    }

    internal fun say(s: String, w: String) { state = s; says = w }

    private fun go(c: Context, tag: String) {
        try {
            val assets = JSONObject(get("$API/repos/$REPO/releases/tags/$tag")).optJSONArray("assets")
            fun url(name: String): String {
                for (i in 0 until (assets?.length() ?: 0)) {
                    val a = assets!!.getJSONObject(i)
                    if (a.optString("name") == name) return a.getString("browser_download_url")
                }
                throw IllegalStateException("the release $tag has no $name")
            }
            val side = JSONObject(get(url("mandarin-bridge.apk.json")))
            val sha = side.optString("sha256").lowercase()
            if (sha.length != 64) throw IllegalStateException("the release says no checksum for its build")
            to = side.optString("commit")
            val apk = File(c.cacheDir, "update.apk")
            download(url("mandarin-bridge.apk"), apk)
            val got = MessageDigest.getInstance("SHA-256").digest(apk.readBytes()).joinToString("") { "%02x".format(it) }
            if (got != sha) throw IllegalStateException("the download isn't the build the release says (its checksum differs)")
            if (Build.VERSION.SDK_INT >= 26 && !c.packageManager.canRequestPackageInstalls()) {
                // Asked once, on the device: Settings → Apps → Mandarin Bridge → Install unknown apps.
                notify(c, "Let Mandarin Bridge install its update", "Tap, and allow it to install apps; then update it again from Mandarin.",
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.packageName)))
                say("needs-you", "On the device: allow Mandarin Bridge to install apps (its notification), then update it again")
                return
            }
            say("installing", "Installing the update")
            install(c, apk)
        } catch (e: Exception) {
            say("failed", "The update couldn't be installed: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    // [apk] installed over this app, a session committed: its outcome comes to UpdateReceiver.
    private fun install(c: Context, apk: File) {
        val installer = c.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(c.packageName)
            // Android 12 and later: no question asked where this app installed the version it replaces.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("mandarin-bridge.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                s.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val done = PendingIntent.getBroadcast(c, id, Intent(c, UpdateReceiver::class.java), flags)
            s.commit(done.intentSender)
        }
    }

    /** A notification on the device that opens [open] when tapped: what the update needs of the person holding it. */
    internal fun notify(c: Context, title: String, text: String, open: Intent) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_HIGH))
        val tap = PendingIntent.getActivity(c, 0, open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0))
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(c, CHANNEL) else Notification.Builder(c)
        nm.notify(NOTIFICATION, b.setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(text)
            .setContentIntent(tap).setAutoCancel(true).build())
    }

    private fun get(url: String): String = open(url).inputStream.bufferedReader().use { it.readText() }

    private fun download(url: String, to: File) {
        open(url).inputStream.use { i -> to.outputStream().use { o -> i.copyTo(o) } }
    }

    // [url], redirects followed (GitHub's downloads are), refused unless it answers 200.
    private fun open(url: String): HttpURLConnection {
        var at = url
        repeat(6) {
            val h = URL(at).openConnection() as HttpURLConnection
            h.connectTimeout = 15_000; h.readTimeout = 60_000; h.instanceFollowRedirects = false
            h.setRequestProperty("User-Agent", "mandarin-bridge")
            when (h.responseCode) {
                200 -> return h
                301, 302, 303, 307, 308 -> { at = URL(URL(at), h.getHeaderField("Location")).toString(); h.disconnect() }
                else -> { val code = h.responseCode; h.disconnect(); throw IllegalStateException("$url answered $code") }
            }
        }
        throw IllegalStateException("$url: too many redirects")
    }
}

/** The package installer's word on the update: done, refused, or waiting on the person holding the device. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else i.getParcelableExtra(Intent.EXTRA_INTENT)
                if (confirm != null) Updater.notify(c, "Finish updating Mandarin Bridge", "Tap, then Update: from now on its updates need nothing here.", confirm)
                Updater.say("needs-you", "On the device: tap Mandarin Bridge's notification, then Update")
            }
            PackageInstaller.STATUS_SUCCESS -> Updater.say("idle", "Updated")
            else -> Updater.say("failed", "The update couldn't be installed: " + (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "the installer refused it"))
        }
    }
}
