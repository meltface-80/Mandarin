package com.musicd.server.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Backup & restore in the app (v0.6.14).
 *
 * The app's own settings ([export], [import]): downloads, USB DAC, this phone's
 * DSP and volume levelling, the music and download folders. Never the server's
 * address, the sign-in, or what the app keeps for itself (its play queue for
 * the server, download records).
 *
 * A backup from the app is one file, saved where you choose (Android's own
 * "save as"): the server makes it (its settings, the players', your collection,
 * the keys, the whole database if chosen) with this app's settings and this
 * screen's settings in it. Restoring sends the file to the server, which
 * applies its part and hands back the app's and the screen's, applied here.
 */
object AppBackup {
    private const val TAG = "AppBackup"

    // prefs file → the keys a person sets (and nothing the app keeps for itself).
    private val KEYS = mapOf(
        "musicd" to listOf("dsp", "replaygain", "usb_direct", "usb_volume", "usb_fixed", "usb_dsd", "usb_limit",
            "away_engine", "zone", "local_folder", "download_folder", "download_sub"),
        "downloads" to listOf("quality", "wifi_only", "limit_gb", "location", "auto_picks", "auto_aotd", "auto_recent",
            "away_quality", "cache_wifi", "cache_mobile", "cache_gb")
    )
    // Saved Android folder grants: kept only while this install still holds them.
    private val FOLDER_KEYS = setOf("local_folder", "download_folder")

    fun export(c: Context): JSONObject {
        val out = JSONObject()
        for ((file, keys) in KEYS) {
            val all = c.getSharedPreferences(file, Context.MODE_PRIVATE).all
            val o = JSONObject()
            for (k in keys) {
                val v = all[k] ?: continue
                val t = when (v) { is Boolean -> "b"; is Int -> "i"; is Long -> "l"; is Float -> "f"; is String -> "s"; else -> continue }
                o.put(k, JSONObject().put("t", t).put("v", v))
            }
            out.put(file, o)
        }
        return JSONObject().put("format", 1).put("version", BuildConfig.VERSION_NAME).put("prefs", out)
    }

    /** The app's settings from a backup; what couldn't be put back, said. */
    fun import(c: Context, app: JSONObject): JSONObject {
        val prefs = app.optJSONObject("prefs") ?: return JSONObject().put("ok", false)
        val held = runCatching { c.contentResolver.persistedUriPermissions.map { it.uri.toString() }.toSet() }.getOrDefault(emptySet())
        val chooseAgain = JSONArray()
        for ((file, keys) in KEYS) {
            val o = prefs.optJSONObject(file) ?: continue
            val e = c.getSharedPreferences(file, Context.MODE_PRIVATE).edit()
            for (k in keys) {
                if (!o.has(k)) { if (k !in FOLDER_KEYS) e.remove(k); continue }
                val x = o.getJSONObject(k)
                if (k in FOLDER_KEYS) {
                    val uri = x.optString("v")
                    if (uri.startsWith("content:") && uri !in held) { chooseAgain.put(k); continue }
                }
                when (x.optString("t")) {
                    "b" -> e.putBoolean(k, x.getBoolean("v"))
                    "i" -> e.putInt(k, x.getInt("v"))
                    "l" -> e.putLong(k, x.getLong("v"))
                    "f" -> e.putFloat(k, x.getDouble("v").toFloat())
                    "s" -> e.putString(k, x.getString("v"))
                }
            }
            e.apply()
        }
        // This phone's DSP, as restored, goes to the server with the next hello.
        if (prefs.optJSONObject("musicd")?.has("dsp") == true) Store.setDspPending(c, true)
        return JSONObject().put("ok", true).put("choose_again", chooseAgain)
    }

    fun fileName(): String = "mandarin-backup-" + SimpleDateFormat("yyyy-MM-dd-HHmm", Locale.ROOT).format(Date()) + ".tar.gz"

    private fun connect(c: Context, path: String): HttpURLConnection {
        val base = Store.active(c)?.baseUrl ?: throw IOException("No server")
        val token = Store.token(c) ?: throw IOException("Not signed in")
        return (URL(base + path).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10 * 60_000   // a whole database takes a while
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("User-Agent", "MusicDAndroid/${BuildConfig.VERSION_NAME}")
        }
    }

    private fun errorOf(conn: HttpURLConnection): String =
        runCatching { JSONObject(conn.errorStream.bufferedReader().readText()).optString("error") }.getOrNull()
            ?.takeIf { it.isNotBlank() } ?: "The server said ${conn.responseCode}"

    /** The server's backup (with this app's settings and the screen's) into [uri]. */
    fun saveTo(c: Context, uri: Uri, request: JSONObject): JSONObject {
        // The app's settings unless left unticked.
        if (!request.optBoolean("noApp")) request.put("app", export(c))
        request.remove("noApp")
        val conn = connect(c, "/api/backup/file")
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(request.toString().toByteArray()) }
            if (conn.responseCode != 200) return JSONObject().put("ok", false).put("error", errorOf(conn))
            var bytes = 0L
            val out = c.contentResolver.openOutputStream(uri, "wt") ?: throw IOException("Couldn't write the file")
            out.use { o -> conn.inputStream.use { i -> bytes = i.copyTo(o, 64 * 1024) } }
            return JSONObject().put("ok", true).put("bytes", bytes)
        } finally { conn.disconnect() }
    }

    /** The backup at [uri] sent to the server; the app's part applied here. */
    fun restoreFrom(c: Context, uri: Uri, parts: String): JSONObject {
        val conn = connect(c, "/api/backup/restore?parts=" + URLEncoder.encode(parts, "UTF-8"))
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setChunkedStreamingMode(64 * 1024)
            conn.setRequestProperty("Content-Type", "application/gzip")
            val input = c.contentResolver.openInputStream(uri) ?: throw IOException("Couldn't read the file")
            input.use { i -> conn.outputStream.use { o -> i.copyTo(o, 64 * 1024) } }
            if (conn.responseCode != 200) return JSONObject().put("ok", false).put("error", errorOf(conn))
            val res = JSONObject(conn.inputStream.bufferedReader().readText())
            res.optJSONObject("app")?.let { res.put("app_result", import(c, it)); res.remove("app") }
            return res
        } finally { conn.disconnect() }
    }
}

/** The page's way in: window.MusicDBackup. */
class BackupBridge(private val activity: Activity) {
    companion object { const val NAME = "MusicDBackup" }
    private val work = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun available(): Boolean = true

    /** This app's settings, for a backup kept on the server. */
    @JavascriptInterface
    fun appSettings(): String = AppBackup.export(activity).toString()

    /** The app's part of a backup restored from the server's list. */
    @JavascriptInterface
    fun applyApp(json: String): String =
        runCatching { AppBackup.import(activity, JSONObject(json)).toString() }.getOrElse { JSONObject().put("ok", false).put("error", it.message).toString() }

    /** Back up to a file: Android's "save as", then the server's backup into it. Answers window.__backupFileDone. */
    @JavascriptInterface
    fun toFile(requestJson: String) {
        (activity as? MainActivity)?.chooseBackupFile(AppBackup.fileName()) { uri ->
            if (uri == null) { tell("__backupFileDone", JSONObject().put("ok", false).put("cancelled", true)); return@chooseBackupFile }
            work.execute {
                val r = runCatching { AppBackup.saveTo(activity, uri, JSONObject(requestJson)) }
                    .getOrElse { Log.w("AppBackup", "backup: ${it.message}"); JSONObject().put("ok", false).put("error", it.message ?: "Backup failed") }
                tell("__backupFileDone", r)
            }
        }
    }

    /** Restore from a file: Android's "open", then sent to the server. Answers window.__backupRestoreDone. */
    @JavascriptInterface
    fun fromFile(parts: String) {
        (activity as? MainActivity)?.openBackupFile { uri ->
            if (uri == null) { tell("__backupRestoreDone", JSONObject().put("ok", false).put("cancelled", true)); return@openBackupFile }
            work.execute {
                val r = runCatching { AppBackup.restoreFrom(activity, uri, parts) }
                    .getOrElse { Log.w("AppBackup", "restore: ${it.message}"); JSONObject().put("ok", false).put("error", it.message ?: "Restore failed") }
                tell("__backupRestoreDone", r)
            }
        }
    }

    private fun tell(fn: String, json: JSONObject) {
        (activity as? MainActivity)?.tellPage("window.$fn && window.$fn(${JSONObject.quote(json.toString())})")
    }
}
