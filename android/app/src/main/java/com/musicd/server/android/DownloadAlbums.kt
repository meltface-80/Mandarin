package com.musicd.server.android

import android.content.Context
import java.io.File
import java.util.concurrent.Executors

/**
 * The albums on the phone as one list ([DownloadStore.albums]), read from
 * their album.json files.
 *
 * The page asks for it through the app's bridge ([DownloadsBridge]), and the
 * page's script waits there until the answer comes. Each change used to drop
 * the list, and the page, told of the change, read every album.json again
 * while it waited, after every track a download finished too (v1.0.7). Now a
 * change is read here, on this thread, before anyone is told of it
 * ([changed]), and the page is given the list as last read at once, a newer
 * one read behind it when that one is old ([forPage]).
 */
internal object DownloadAlbums {
    private const val FRESH_MS = 10_000L

    @Volatile private var cache: Pair<Long, List<Pair<DownloadStore.Album, File>>>? = null
    /** Counts changes, so a read begun before one never stands for after it. */
    @Volatile private var gen = 0
    @Volatile private var reading = false
    private val reader = Executors.newSingleThreadExecutor { r -> Thread(r, "downloads-albums").apply { isDaemon = true } }

    /** Every album on the phone, newest first: read from disk at most every few seconds, and again after any change. */
    fun list(c: Context): List<Pair<DownloadStore.Album, File>> {
        cache?.let { (at, l) -> if (System.currentTimeMillis() - at < FRESH_MS) return l }
        return read(c)
    }

    /** For the page: the list as last read, at once (read now only when there is none). */
    fun forPage(c: Context): List<Pair<DownloadStore.Album, File>> {
        val had = cache ?: return list(c)
        if (System.currentTimeMillis() - had.first >= FRESH_MS && !reading) {
            reading = true
            val app = c.applicationContext
            runCatching { reader.execute { try { runCatching { read(app) } } finally { reading = false } } }.onFailure { reading = false }
        }
        return had.second
    }

    /** Something changed: the list read again, off the caller's thread, then [tell] (on that thread). */
    fun changed(c: Context?, tell: () -> Unit) {
        gen++
        cache = null
        if (c == null) { tell(); return }
        runCatching { reader.execute { runCatching { read(c) }; tell() } }.onFailure { tell() }
    }

    private fun read(c: Context): List<Pair<DownloadStore.Album, File>> {
        val began = gen
        val all = DownloadStore.places(c)
        val out = all.flatMap { p -> p.dir.listFiles()?.toList() ?: emptyList() }
            .filter { File(it, "album.json").exists() }
            .mapNotNull { d -> DownloadStore.load(d)?.let { it to d } }
            .sortedByDescending { it.first.addedAt }
        all.firstOrNull { it.id == DownloadStore.PLACE_FOLDER }?.let { fp ->
            DownloadStore.rememberFolderAlbums(c, out.filter { it.second.parentFile?.canonicalPath == fp.dir.canonicalPath }.map { it.first })
        }
        if (began == gen) cache = System.currentTimeMillis() to out
        return out
    }
}
