package com.musicd.server.android

import android.content.Context
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * The app's own copy of MusicD's interface, for when the server can't be
 * reached: the page, its script and stylesheet (the app's versions of them),
 * its icons, the settings it reads at start, and every downloaded album's
 * page. Refreshed in the background each time the page loads from the server,
 * so it is the same interface — the same version — as the last one seen.
 *
 * Offline, MainActivity keeps the page on the server's own address and
 * answers its requests from here and from [OfflineApi]: the interface is the
 * one you know, showing what's on the phone.
 */
object OfflineSite {
    private const val TAG = "OfflineSite"

    /** Files of the page itself: its address → the file it's kept in. */
    private val STATIC = listOf(
        "/" to "index.html", "/style.css" to "style.css", "/app.js" to "app.js",
        "/sharecard.js" to "sharecard.js", "/srp.js" to "srp.js", "/manifest.json" to "manifest.json",
        "/icons/icon-192.png" to "icon-192.png", "/icons/apple-touch-icon.png" to "apple-touch-icon.png",
        "/icons/favicon.ico" to "favicon.ico"
    )

    /** Settings and lists the page asks for at start; kept as the server last answered. */
    val CACHED_API = listOf(
        "/api/settings/home-rows", "/api/settings/waveform", "/api/settings/smart-picks",
        "/api/settings/discover", "/api/settings/labels", "/api/settings/share-links",
        "/api/settings/display", "/api/settings/label-folder-depth", "/api/settings/fanart-key",
        "/api/settings/discogs-token", "/api/settings/qobuz", "/api/settings/tidal",
        "/api/settings/tidal/status", "/api/update/status", "/api/filters/tags",
        "/api/filters/labels", "/api/user-playlists", "/api/smart-playlists", "/api/playlists"
    )

    private val work = Executors.newSingleThreadExecutor()
    @Volatile private var syncing = false

    private fun dir(c: Context) = File(c.filesDir, "site").apply { mkdirs() }

    /** A copy good enough to open offline. */
    fun has(c: Context) = File(dir(c), "index.html").exists() && File(dir(c), "app.js").exists()

    /** A file of the page, by the address it's asked for, with its type — or null. */
    fun file(c: Context, path: String): Pair<File, String>? {
        val name = STATIC.firstOrNull { it.first == path || (path == "/index.html" && it.first == "/") }?.second ?: return null
        val f = File(dir(c), name)
        return if (f.exists()) f to mimeOf(name) else null
    }

    /** A settings answer as last seen, or null. */
    fun api(c: Context, path: String): String? {
        val f = File(dir(c), "api" + path.replace('/', '_') + ".json")
        return if (f.exists()) runCatching { f.readText() }.getOrNull() else null
    }

    private fun mimeOf(name: String) = when {
        name.endsWith(".html") -> "text/html"
        name.endsWith(".css") -> "text/css"
        name.endsWith(".js") -> "application/javascript"
        name.endsWith(".json") -> "application/json"
        name.endsWith(".png") -> "image/png"
        name.endsWith(".ico") -> "image/x-icon"
        else -> "application/octet-stream"
    }

    /** Refresh the copy from the server (in the background; at most one at a time). */
    @Volatile private var lastSync = 0L

    fun sync(c: Context) {
        if (syncing) return
        // Every page load would be too often; every few minutes keeps it current.
        if (has(c) && System.currentTimeMillis() - lastSync < 5 * 60 * 1000) return
        lastSync = System.currentTimeMillis()
        val app = c.applicationContext
        val base = Store.active(app)?.baseUrl ?: return
        val token = Store.token(app) ?: return
        syncing = true
        work.execute {
            try {
                val d = dir(app)
                for ((path, name) in STATIC) runCatching { save(File(d, name), get(base + path, token)) }
                    .onFailure { Log.i(TAG, "$path: ${it.message}") }
                for (path in CACHED_API) runCatching {
                    save(File(d, "api" + path.replace('/', '_') + ".json"), get(base + path, token))
                }
                // Each downloaded album's page, as the server shows it.
                for ((album, albumDir) in DownloadStore.albums(app)) runCatching {
                    save(File(albumDir, "page.json"), get("$base/api/album?offset=${album.id}", token))
                }
            } finally {
                syncing = false
            }
        }
    }

    /** One album's page, fetched when it's downloaded. */
    fun savePage(c: Context, albumId: Int, albumDir: File) {
        val base = Store.active(c)?.baseUrl ?: return
        val token = Store.token(c) ?: return
        runCatching { save(File(albumDir, "page.json"), get("$base/api/album?offset=$albumId", token)) }
    }

    private fun save(f: File, bytes: ByteArray) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    private fun get(url: String, token: String): ByteArray {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 20_000
            useCaches = false
            setRequestProperty("Authorization", "Bearer $token")
            // The app's own versions of the page and stylesheet.
            setRequestProperty("User-Agent", "MusicDAndroid/${BuildConfig.VERSION_NAME}")
        }
        try {
            if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }
}
