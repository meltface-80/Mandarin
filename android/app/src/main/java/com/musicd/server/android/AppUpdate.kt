package com.musicd.server.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.content.FileProvider
import com.musicd.server.client.Release
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * The app keeps itself up to date: it looks at the APK GitHub Actions
 * publishes (dist/latest.json on main), and when that's newer than this one
 * it offers to fetch it and install it over the top — the same signing key
 * every time, so nothing is uninstalled and downloads stay on the phone.
 *
 * The update banner (UpdateNow, bug list item 111) asks here ([lookup],
 * [statusJson]) alongside the server's own update, shows one offer for
 * whichever is newer, and its Update installs this one ([installNow]) once the
 * server's is done; Settings → Updates asks here for this app's row alone
 * (item 223), its notes under it.
 */
object AppUpdate {
    private const val TAG = "AppUpdate"
    private const val CHECK_EVERY_MS = 60L * 60 * 1000

    private val work = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var busy = false

    /** The newest app GitHub has, as last looked up (null: not looked, or couldn't). */
    @Volatile private var known: Release? = null
    @Volatile private var lookedAt = 0L
    @Volatile private var looking = false

    /** For the banner and Settings → Updates: {"current", "latest", "available", "installing", "notes"}. */
    fun statusJson(): String {
        val r = known
        return JSONObject().put("current", BuildConfig.VERSION_NAME)
            .put("latest", r?.version ?: JSONObject.NULL)
            .put("available", r != null && r.newerThan(BuildConfig.VERSION_NAME))
            .put("installing", busy)
            .put("notes", r?.notes ?: JSONObject.NULL)
            .toString()
    }

    /** Look for a newer app (at most once an hour unless [force]), then [done] on the main thread. */
    fun lookup(force: Boolean, done: () -> Unit) {
        val now = System.currentTimeMillis()
        if (looking || (!force && known != null && now - lookedAt < CHECK_EVERY_MS)) { main.post(done); return }
        looking = true
        work.execute {
            val r = runCatching { latest() }.onFailure { Log.i(TAG, "couldn't look for an update: ${it.message}") }.getOrNull()
            if (r != null) { known = r; lookedAt = System.currentTimeMillis() }
            looking = false
            main.post(done)
        }
    }

    /** [a] closed or destroyed (item 192: the phone turned while the update downloaded): no dialog, no installer, from it. */
    private fun gone(a: Activity) = a.isFinishing || a.isDestroyed

    /** Update: fetch the newer app and hand it to Android's installer, no second question; looked for first if need be. */
    fun installNow(activity: Activity) {
        if (gone(activity)) return
        val r = known
        if (r != null && r.newerThan(BuildConfig.VERSION_NAME)) { download(activity, r); return }
        lookup(true) {
            if (gone(activity)) return@lookup
            val n = known
            if (n != null && n.newerThan(BuildConfig.VERSION_NAME)) download(activity, n)
            else toast(activity, if (n == null) "Couldn't reach GitHub to look for an update" else "Mandarin is up to date (v${BuildConfig.VERSION_NAME})")
        }
    }

    private fun apkFile(c: Context, r: Release) = File(File(c.cacheDir, "updates").apply { mkdirs() }, "musicd-${r.version}.apk")

    private fun download(activity: Activity, r: Release) {
        val dest = apkFile(activity, r)
        // An earlier download of this version: checked off the screen thread (hashing
        // tens of megabytes on it froze the app), then installed — or fetched again.
        if (dest.exists() && !busy) {
            busy = true
            work.execute {
                val ok = runCatching { r.sha256.isEmpty() || sha256(dest) == r.sha256 }.getOrDefault(false)
                if (!ok) dest.delete()
                main.post {
                    busy = false
                    if (gone(activity)) return@post
                    if (ok) install(activity, dest) else download(activity, r)
                }
            }
            return
        }
        if (gone(activity)) return
        val progress = AlertDialog.Builder(activity)
            .setTitle("Updating Mandarin")
            .setMessage("Downloading version ${r.version}…")
            .setCancelable(false)
            .show()
        busy = true
        work.execute {
            val result = runCatching {
                // Only the newest one is kept.
                dest.parentFile?.listFiles()?.forEach { if (it != dest) it.delete() }
                fetch(r.url, dest) { pct -> main.post { progress.setMessage("Downloading version ${r.version}… $pct%") } }
                if (r.sha256.isNotEmpty() && sha256(dest) != r.sha256) {
                    dest.delete()
                    throw IOException("the download was damaged — try again")
                }
            }
            main.post {
                busy = false
                runCatching { progress.dismiss() }
                if (gone(activity)) return@post
                result.onSuccess { install(activity, dest) }
                    .onFailure { toast(activity, "Couldn't download the update: " + com.musicd.server.client.Failure.said(it, "no answer")) }
            }
        }
    }

    /** Hand the APK to Android's installer — which asks, once, to allow installs from MusicD. */
    private fun install(activity: Activity, apk: File) {
        if (gone(activity)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle("Allow Mandarin to install updates")
                .setMessage("Android asks once: turn on \"Allow from this source\" for Mandarin, come back, and tap Update again.")
                .setPositiveButton("Open settings") { _, _ ->
                    runCatching {
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".shares", apk)
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { toast(activity, "Couldn't open the installer: " + com.musicd.server.client.Failure.said(it, "no answer")) }
    }

    private fun latest(): Release? =
        runCatching { latestFrom(Release.LATEST_API, Release.API_ACCEPT) }.getOrNull()
            ?: latestFrom(Release.LATEST, null)

    private fun latestFrom(url: String, accept: String?): Release? {
        val c = open(url)
        if (accept != null) c.setRequestProperty("Accept", accept)
        c.useCaches = false
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            return Release.parse(JSONObject(c.inputStream.bufferedReader().readText()))
        } finally {
            c.disconnect()
        }
    }

    private fun fetch(url: String, dest: File, onProgress: (Int) -> Unit) {
        val c = open(url, readTimeout = 60_000)
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            val total = c.contentLengthLong
            var got = 0L
            var shown = -1
            c.inputStream.use { input ->
                FileOutputStream(dest).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        if (total > 0) {
                            val pct = (got * 100 / total).toInt()
                            if (pct != shown) { shown = pct; onProgress(pct) }
                        }
                    }
                }
            }
        } finally {
            c.disconnect()
        }
    }

    /** GitHub answers raw/… with a redirect to its file host, which HttpURLConnection follows (https → https). */
    private fun open(url: String, readTimeout: Int = 15_000): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            this.readTimeout = readTimeout
            instanceFollowRedirects = true
            useCaches = false
            setRequestProperty("User-Agent", "MusicDAndroid/${BuildConfig.VERSION_NAME}")
        }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = s.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun toast(c: Context, s: String) = Toast.makeText(c, s, Toast.LENGTH_LONG).show()
}
