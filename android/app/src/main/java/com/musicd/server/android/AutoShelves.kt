package com.musicd.server.android

import android.content.Context
import android.util.Log
import androidx.media3.common.MediaItem
import com.musicd.server.client.AutoShelf
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Android Auto's Random albums and Smart Picks (item 533; core AutoShelf). They were asked of the server only as the
 * car opened one, and away from home the phone's way to it (its own Tailscale, stopped while the app is off screen)
 * was often not up yet: the car was handed nothing and kept that until the app was opened. Now:
 *   - each is kept on the phone (the albums, and their covers as the car is given them) and shown at once, read again
 *     behind it once ten minutes old, the car told when the new one is in ([changed]);
 *   - both are read as the car connects ([warm]), not when it first opens one;
 *   - before the server is asked, the way to it is looked at and, away, the phone's own Tailscale brought up and waited
 *     for; one that fails is asked again twice.
 * [item] makes an album the car can play. A shelf read again behind the car's runs on threads of its own (it can wait
 * a minute for the way to the server), never the player's browsing ones.
 */
internal class AutoShelves(
    private val context: Context,
    private val item: (AutoShelf.Album, ByteArray?) -> MediaItem,
    private val changed: (String) -> Unit,
) {
    private val kept = ConcurrentHashMap<String, Pair<Long, List<MediaItem>>>()
    private val reading: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val dir = File(context.cacheDir, "auto-shelves")
    private val covers = Executors.newFixedThreadPool(4)
    private val pool = Executors.newFixedThreadPool(2)

    /** As the car connects: each shelf not read lately, read now, behind what the car is shown. */
    fun warm() { for (shelf in listOf(AutoShelf.RANDOM, AutoShelf.PICKS)) if (fresh(shelf) == null) refresh(shelf) }

    /** [shelf]'s albums for the car: as kept (read again behind them where due), else read now. Off the main thread. */
    fun children(shelf: String): List<MediaItem> {
        val k = kept[shelf] ?: fromDisk(shelf)
        if (k != null) {
            if (AutoShelf.due(k.first, System.currentTimeMillis())) refresh(shelf)
            return k.second
        }
        return read(shelf) ?: emptyList()
    }

    /* The shelf as kept, where it isn't due a reading. */
    private fun fresh(shelf: String): Pair<Long, List<MediaItem>>? =
        (kept[shelf] ?: fromDisk(shelf))?.takeIf { !AutoShelf.due(it.first, System.currentTimeMillis()) }

    private fun refresh(shelf: String) {
        if (!reading.add(shelf)) return
        pool.execute { try { if (read(shelf) != null) changed(shelf) } finally { reading.remove(shelf) } }
    }

    /* The shelf read from the server, kept here and on disk; null where it couldn't be. */
    private fun read(shelf: String): List<MediaItem>? {
        val albums = ask(shelf) ?: return null
        val art = coversOf(albums)
        val items = albums.mapIndexed { i, a -> item(a, art[i]) }
        val now = System.currentTimeMillis()
        kept[shelf] = now to items
        runCatching { dir.mkdirs(); File(dir, "$shelf.json").writeText(AutoShelf.keep(albums, now)) }
        return items
    }

    /* The server asked for [shelf], its way looked at first (away: the phone's own Tailscale up), three tries. */
    private fun ask(shelf: String): List<AutoShelf.Album>? {
        for (attempt in 0 until 3) {
            Away.awaitWay(context)
            if (Store.isAway(context) && Store.viaEngine(context) && !TailscaleEngine.alive()) Away.revive(context, 20_000)
            val client = Store.client(context) ?: return null
            val got = runCatching { AutoShelf.parse(shelf, client.getJson(AutoShelf.path(shelf), 10_000)) }
            got.getOrNull()?.let { return it }
            Log.i(TAG, "$shelf for the car: ${got.exceptionOrNull()?.message} (try ${attempt + 1} of 3)")
            Thread.sleep(2_000L * (attempt + 1))
        }
        return null
    }

    /* The shelf as last kept on disk, its covers from the files kept beside it. */
    private fun fromDisk(shelf: String): Pair<Long, List<MediaItem>>? {
        val (at, albums) = AutoShelf.kept(runCatching { File(dir, "$shelf.json").readText() }.getOrNull()) ?: return null
        return (at to albums.map { a -> item(a, coverFile(a.imageKey)?.let { f -> runCatching { f.readBytes() }.getOrNull() }) })
            .also { kept[shelf] = it }
    }

    /* Each album's cover, kept on disk by its key (a new cover is a new key), fetched four at a time, eight seconds in all. */
    private fun coversOf(albums: List<AutoShelf.Album>): List<ByteArray?> {
        val client = Store.client(context)
        val jobs = albums.map { a ->
            Callable {
                val f = coverFile(a.imageKey) ?: return@Callable null
                if (f.exists()) return@Callable runCatching { f.readBytes() }.getOrNull()
                val b = client?.let { c -> runCatching { c.bytes(c.imageUrl(a.imageKey, 300)) }.getOrNull() } ?: return@Callable null
                runCatching { f.parentFile?.mkdirs(); f.writeBytes(b) }
                b
            }
        }
        val got = runCatching { covers.invokeAll(jobs, 8, TimeUnit.SECONDS) }.getOrDefault(emptyList())
        return albums.indices.map { i -> got.getOrNull(i)?.let { f -> if (f.isCancelled) null else runCatching { f.get() }.getOrNull() } }
    }

    /** The player gone: its threads let go. */
    fun close() { pool.shutdownNow(); covers.shutdownNow() }

    private fun coverFile(imageKey: String): File? =
        imageKey.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.takeIf { it.isNotEmpty() }?.let { File(dir, "covers/$it.jpg") }

    private companion object { const val TAG = "AutoShelves" }
}
