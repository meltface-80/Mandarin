package com.musicd.server.android

import android.content.Context
import android.util.Log
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * What the server last said, kept for when it can't be reached: the settings and lists the screens ask for at the start,
 * and every downloaded album's page. Refreshed in the background while the server answers (ServerReach), so offline the
 * screens show what they last showed ([OfflineApi] answers from it). The copy of the page itself went with the WebView
 * (bug list item 111).
 */
object OfflineSite {
    private const val TAG = "OfflineSite"

    /** Settings and lists the screens ask for; kept as the server last answered. */
    val CACHED_API = listOf(
        "/api/settings/home-rows", "/api/settings/waveform", "/api/settings/smart-picks",
        "/api/settings/discover", "/api/settings/labels", "/api/settings/share-links",
        "/api/settings/display", "/api/settings/label-folder-depth", "/api/settings/fanart-key",
        "/api/settings/discogs-token", "/api/settings/qobuz",
        "/api/update/status", "/api/filters/tags",
        "/api/filters/labels", "/api/user-playlists", "/api/smart-playlists", "/api/playlists"
    )

    private val work = Executors.newSingleThreadExecutor()
    @Volatile private var syncing = false

    private fun dir(c: Context) = File(c.filesDir, "site").apply { mkdirs() }

    /** A settings answer as last seen, or null. */
    fun api(c: Context, path: String): String? {
        val f = File(dir(c), "api" + path.replace('/', '_') + ".json")
        return if (f.exists()) runCatching { f.readText() }.getOrNull() else null
    }

    /** Refresh the copy from the server (in the background; at most one at a time). */
    @Volatile private var lastSync = 0L

    fun sync(c: Context) {
        if (syncing) return
        // Every look at the server would be too often; every few minutes keeps it current.
        if (System.currentTimeMillis() - lastSync < 5 * 60 * 1000) return
        lastSync = System.currentTimeMillis()
        val app = c.applicationContext
        val base = Store.active(app)?.baseUrl ?: return
        val token = Store.token(app) ?: return
        syncing = true
        work.execute {
            try {
                val d = dir(app)
                // The copy of the page an app before item 111 kept here: no use now.
                d.listFiles()?.filter { !it.name.startsWith("api_") }?.forEach { it.delete() }
                // Each asked for only if changed (v0.6.10): the server answers "not modified" for the copy already kept.
                for (path in CACHED_API) runCatching {
                    refresh(File(d, "api" + path.replace('/', '_') + ".json"), base + path, token)
                }
                // Each downloaded album's page, as the server shows it.
                for ((album, albumDir) in DownloadStore.albums(app)) runCatching {
                    refresh(File(albumDir, "page.json"), "$base/api/album?offset=${album.id}", token)
                }
                // A cover that didn't come with its album (the download only tried once):
                // fetched now, so the album isn't a blank tile offline.
                for ((album, albumDir) in DownloadStore.albums(app)) {
                    val cover = File(albumDir, "cover.jpg")
                    if (album.state != "done" || cover.exists()) continue
                    val key = album.imageKey ?: "al-${album.id}"
                    runCatching { save(cover, get("$base/api/image/${java.net.URLEncoder.encode(key, "UTF-8")}?size=1200", token)) }
                        .onFailure { Log.i(TAG, "cover of ${album.id}: ${it.message}") }
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

    /**
     * Fetch [url] into [f] unless the server says the copy kept is current:
     * the copy's ETag (kept beside it as name.etag) goes with the request,
     * and a 304 leaves the file as it is.
     */
    private fun refresh(f: File, url: String, token: String) {
        val tagFile = File(f.parentFile, f.name + ".etag")
        val known = if (f.exists() && tagFile.exists()) runCatching { tagFile.readText() }.getOrNull() else null
        val (bytes, tag) = get(url, token, known) ?: return
        save(f, bytes)
        if (tag != null) runCatching { tagFile.writeText(tag) } else tagFile.delete()
    }

    private fun save(f: File, bytes: ByteArray) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    private fun get(url: String, token: String): ByteArray = get(url, token, null)!!.first

    /** The body and its ETag; null when [etag] is still current (304). */
    private fun get(url: String, token: String, etag: String?): Pair<ByteArray, String?>? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 20_000
            useCaches = false
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("User-Agent", "MusicDAndroid/${BuildConfig.VERSION_NAME}")
            if (etag != null) setRequestProperty("If-None-Match", etag)
        }
        try {
            if (etag != null && conn.responseCode == 304) return null
            if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
            return conn.inputStream.use { it.readBytes() } to conn.getHeaderField("ETag")
        } finally {
            conn.disconnect()
        }
    }
}
