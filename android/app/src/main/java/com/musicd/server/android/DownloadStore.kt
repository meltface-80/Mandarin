package com.musicd.server.android

import android.content.Context
import android.os.Environment
import com.musicd.server.client.CachePlan
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Albums kept on this phone, and the settings for keeping them.
 *
 * Each album is a folder named by its id — album.json (the album, its tracks
 * and how far the download has got), cover.jpg, and one file per track —
 * in the app's own storage on the phone or on an SD card. Those folders need
 * no storage permission; the catch is that Android deletes them if the app is
 * uninstalled (updates are fine).
 *
 * Since v0.5.27 there is a third place: the "Mandarin" folder inside the
 * music folder chosen in Settings → Downloads (LocalMusic), on the phone or
 * an SD card. Albums there outlive the app: a fresh install pointed at the
 * same folder finds them again, album.json being the index. Writing there
 * as plain files needs Android's "all files" access, which the user grants
 * once in the system settings (the app opens the page).
 */
object DownloadStore {
    private const val PREFS = "downloads"

    // ------------------------------------------------------------ changes

    private val listeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    /** [l] is told whenever an album is added, progresses, finishes or is removed (any thread). */
    fun listen(l: () -> Unit) { listeners += l }
    fun unlisten(l: () -> Unit) { listeners -= l }
    private fun changed() { for (l in listeners) runCatching { l() } }

    const val QUALITY_ORIGINAL = "original"
    const val QUALITY_OPUS = "opus"

    // ------------------------------------------------------------ settings

    class Settings(
        val quality: String, val location: String, val wifiOnly: Boolean, val limitGb: Int,
        /** Automatic downloads: today's Smart Picks, the Album of the day, the newest [autoRecent] albums. */
        val autoPicks: Boolean, val autoAotd: Boolean, val autoRecent: Int,
        /** Streaming away from home: Opus 256 made by the server, or the original files. */
        val awayQuality: String = QUALITY_OPUS,
        /** Playing on the phone: tracks kept on the phone ahead, on Wi-Fi and on mobile data; the cache's limit. */
        val cacheWifi: Int = CachePlan.WIFI_DEFAULT,
        val cacheMobile: Int = CachePlan.MOBILE_DEFAULT,
        val cacheGb: Int = CachePlan.SIZE_DEFAULT_GB
    ) {
        val autoOn get() = autoPicks || autoAotd || autoRecent > 0
    }

    fun settings(c: Context): Settings {
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Settings(
            quality = p.getString("quality", QUALITY_ORIGINAL) ?: QUALITY_ORIGINAL,
            location = p.getString("location", "phone") ?: "phone",
            wifiOnly = p.getBoolean("wifi_only", true),
            limitGb = p.getInt("limit_gb", 0),
            autoPicks = p.getBoolean("auto_picks", false),
            autoAotd = p.getBoolean("auto_aotd", false),
            autoRecent = p.getInt("auto_recent", 0),
            awayQuality = p.getString("away_quality", QUALITY_OPUS) ?: QUALITY_OPUS,
            cacheWifi = CachePlan.pick(p.getInt("cache_wifi", CachePlan.WIFI_DEFAULT), CachePlan.WIFI_CHOICES, CachePlan.WIFI_DEFAULT),
            cacheMobile = CachePlan.pick(p.getInt("cache_mobile", CachePlan.MOBILE_DEFAULT), CachePlan.MOBILE_CHOICES, CachePlan.MOBILE_DEFAULT),
            cacheGb = CachePlan.pick(p.getInt("cache_gb", CachePlan.SIZE_DEFAULT_GB), CachePlan.SIZE_CHOICES_GB, CachePlan.SIZE_DEFAULT_GB)
        )
    }

    fun setQuality(c: Context, q: String) = edit(c) { putString("quality", q) }
    fun setLocation(c: Context, l: String) = edit(c) { putString("location", l) }
    fun setWifiOnly(c: Context, on: Boolean) = edit(c) { putBoolean("wifi_only", on) }
    fun setLimitGb(c: Context, gb: Int) = edit(c) { putInt("limit_gb", gb) }
    fun setAutoPicks(c: Context, on: Boolean) = edit(c) { putBoolean("auto_picks", on) }
    fun setAutoAotd(c: Context, on: Boolean) = edit(c) { putBoolean("auto_aotd", on) }
    fun setAutoRecent(c: Context, n: Int) = edit(c) { putInt("auto_recent", n) }
    fun setAwayQuality(c: Context, q: String) = edit(c) { putString("away_quality", q) }
    fun setCacheWifi(c: Context, n: Int) = edit(c) { putInt("cache_wifi", n) }
    fun setCacheMobile(c: Context, n: Int) = edit(c) { putInt("cache_mobile", n) }
    fun setCacheGb(c: Context, gb: Int) = edit(c) { putInt("cache_gb", gb) }

    private fun edit(c: Context, f: android.content.SharedPreferences.Editor.() -> Unit) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply(f).apply()
    }

    // ------------------------------------------------------------ places

    class Place(val id: String, val label: String, val dir: File) {
        val freeBytes: Long get() = runCatching { dir.usableSpace }.getOrDefault(0L)
    }

    const val PLACE_FOLDER = "folder"

    /** Phone storage, then an SD card if there is one, then the music folder's Mandarin folder when it can be written. */
    fun places(c: Context): List<Place> {
        val dirs = c.getExternalFilesDirs("music").filterNotNull()
        val out = ArrayList<Place>()
        dirs.forEachIndexed { i, d ->
            val removable = i > 0 && runCatching { Environment.isExternalStorageRemovable(d) }.getOrDefault(true)
            if (i == 0) out += Place("phone", "Phone storage", d)
            else if (removable && out.none { it.id == "sd" }) out += Place("sd", "SD card", d)
        }
        if (out.isEmpty()) out += Place("phone", "Phone storage", File(c.filesDir, "music"))
        folderPlace(c)?.let { out += it }
        out.forEach { runCatching { it.dir.mkdirs() } }
        return out
    }

    // ------------------------------------------------------------ the music folder

    /**
     * The chosen music folder as a path — the external storage provider's
     * tree ids are "primary:Music/Qobuz" or "1234-5678:Music", which map to
     * /storage/emulated/0/… and /storage/1234-5678/…. Another provider's
     * folder (a cloud drive, the Downloads provider) has no path, and can't
     * hold downloads.
     */
    fun folderPath(c: Context): File? {
        val u = LocalMusic.folder(c) ?: return null
        if (u.authority != "com.android.externalstorage.documents") return null
        val id = runCatching { android.provider.DocumentsContract.getTreeDocumentId(u) }.getOrNull() ?: return null
        val vol = id.substringBefore(':'); val rel = id.substringAfter(':', "")
        val root = if (vol == "primary") Environment.getExternalStorageDirectory() else File("/storage/$vol")
        return if (rel.isEmpty()) root else File(root, rel)
    }

    /** Android's "all files" access, which writing plain files into the music folder needs. */
    fun allFilesAccess(c: Context): Boolean =
        if (android.os.Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else c.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED

    /** "granted", "needed" (a folder is chosen; access isn't), "unmapped" (that folder can't be written) or "none". */
    fun folderAccess(c: Context): String {
        if (LocalMusic.folder(c) == null) return "none"
        val path = folderPath(c) ?: return "unmapped"
        if (!allFilesAccess(c)) return "needed"
        return if (path.isDirectory) "granted" else "away"
    }

    /** The music folder's Mandarin folder, as a place, when it is there to write. */
    private fun folderPlace(c: Context): Place? {
        if (folderAccess(c) != "granted") return null
        val path = folderPath(c) ?: return null
        val name = LocalMusic.folderName(c) ?: path.name
        return Place(PLACE_FOLDER, "$name › ${LocalMusic.SKIP_DIR}", File(path, LocalMusic.SKIP_DIR))
    }

    /**
     * The albums in the music folder, remembered: when its card is out, the
     * list shows them as away rather than losing them; the next time the
     * folder is there, they are simply there.
     */
    private fun rememberFolderAlbums(c: Context, list: List<Album>) {
        val a = JSONArray()
        for (al in list) a.put(JSONObject().put("id", al.id).put("title", al.title).put("artist", al.artist)
            .put("image_key", al.imageKey ?: "").put("quality", al.quality).put("total", al.tracks.size).put("bytes", al.totalBytes))
        edit(c) { putString("folder_albums", a.toString()) }
    }
    /** Albums in the music folder while it can't be reached (its card out): [{id, title, artist, image_key, quality, total, bytes}]. */
    fun awayAlbums(c: Context): JSONArray {
        if (folderAccess(c) != "away") return JSONArray()
        return runCatching { JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("folder_albums", "[]")) }.getOrDefault(JSONArray())
    }

    // ------------------------------------------------------------ moving

    class Moving(val to: String, val done: Int, val total: Int, val error: String?)
    @Volatile var moving: Moving? = null; private set

    /**
     * Every album not already at [toId] copied there, album by album — the
     * files, then album.json last, then the old folder removed — so a move
     * cut short leaves whole albums at one end or the other, and starting
     * again carries on with the rest.
     */
    fun moveAll(c: Context, toId: String) {
        if (moving != null) return
        val to = places(c).firstOrNull { it.id == toId } ?: return
        val work = albums(c).filter { (a, dir) -> a.state == "done" && dir.parentFile?.canonicalPath != to.dir.canonicalPath }
        if (work.isEmpty()) return
        moving = Moving(toId, 0, work.size, null)
        changed()
        Thread({
            var n = 0
            var err: String? = null
            for ((a, from) in work) {
                try {
                    val dest = File(to.dir, a.id.toString())
                    dest.mkdirs()
                    for (f in from.listFiles() ?: emptyArray()) {
                        if (!f.isFile || f.name == "album.json") continue
                        val d = File(dest, f.name)
                        if (d.exists() && d.length() == f.length()) continue
                        f.copyTo(d, overwrite = true)
                        if (d.length() != f.length()) throw java.io.IOException("short copy of ${f.name}")
                    }
                    File(from, "album.json").copyTo(File(dest, "album.json"), overwrite = true)
                    from.deleteRecursively()
                    n++
                    index = null
                    moving = Moving(toId, n, work.size, null)
                    changed()
                } catch (e: Exception) {
                    err = e.message ?: "couldn't copy"
                    break
                }
            }
            moving = if (err != null) Moving(toId, n, work.size, err) else null
            index = null
            changed()
            if (err != null) { Thread.sleep(8000); moving = null; changed() }
        }, "downloads-move").apply { isDaemon = true; start() }
    }

    /** Where a new download goes: the chosen place, or phone storage if the card is gone. */
    fun target(c: Context): Place {
        val all = places(c)
        return all.firstOrNull { it.id == settings(c).location } ?: all.first()
    }

    // ------------------------------------------------------------ albums

    class Track(
        val id: Long, val title: String, val artist: String, val disc: Int, val number: Int?,
        val duration: Double, val ext: String, val size: Long, var done: Boolean
    ) {
        fun fileName() = "$id.$ext"
    }

    class Album(
        val id: Int, var title: String, var artist: String, var year: Int?, val quality: String,
        var imageKey: String?, var state: String, var error: String?, val tracks: List<Track>, val addedAt: Long,
        /** Downloaded by automatic downloads, and removed again when it drops off their lists. */
        var auto: Boolean = false
    ) {
        val doneCount get() = tracks.count { it.done }
        val totalBytes get() = tracks.sumOf { it.size }
    }

    fun dirOf(c: Context, id: Int): File? =
        places(c).map { File(it.dir, id.toString()) }.firstOrNull { File(it, "album.json").exists() }

    fun albums(c: Context): List<Pair<Album, File>> {
        val all = places(c)
        val out = all.flatMap { p -> p.dir.listFiles()?.toList() ?: emptyList() }
            .filter { File(it, "album.json").exists() }
            .mapNotNull { d -> load(d)?.let { it to d } }
            .sortedByDescending { it.first.addedAt }
        all.firstOrNull { it.id == PLACE_FOLDER }?.let { fp ->
            rememberFolderAlbums(c, out.filter { it.second.parentFile?.canonicalPath == fp.dir.canonicalPath }.map { it.first })
        }
        return out
    }

    fun album(c: Context, id: Int): Album? = dirOf(c, id)?.let { load(it) }

    fun load(dir: File): Album? = runCatching {
        val j = JSONObject(File(dir, "album.json").readText())
        val tracks = j.optJSONArray("tracks") ?: JSONArray()
        Album(
            id = j.getInt("id"), title = j.optString("title"), artist = j.optString("artist"),
            year = if (j.isNull("year") || !j.has("year")) null else j.optInt("year"),
            quality = j.optString("quality", QUALITY_ORIGINAL),
            imageKey = j.optString("image_key").takeIf { it.isNotEmpty() },
            state = j.optString("state", "queued"),
            error = j.optString("error").takeIf { it.isNotEmpty() },
            tracks = (0 until tracks.length()).map { i ->
                val t = tracks.getJSONObject(i)
                Track(
                    t.getLong("id"), t.optString("title"), t.optString("artist"), t.optInt("disc_no", 1),
                    if (t.isNull("track_no") || !t.has("track_no")) null else t.optInt("track_no"),
                    t.optDouble("duration", 0.0), t.optString("ext", "flac"), t.optLong("size"), t.optBoolean("done")
                )
            },
            addedAt = j.optLong("added_at"),
            auto = j.optBoolean("auto", false)
        )
    }.getOrNull()

    fun save(dir: File, a: Album) {
        val tracks = JSONArray()
        for (t in a.tracks) tracks.put(JSONObject()
            .put("id", t.id).put("title", t.title).put("artist", t.artist).put("disc_no", t.disc)
            .put("track_no", t.number ?: JSONObject.NULL).put("duration", t.duration).put("ext", t.ext)
            .put("size", t.size).put("done", t.done))
        val j = JSONObject()
            .put("id", a.id).put("title", a.title).put("artist", a.artist).put("year", a.year ?: JSONObject.NULL)
            .put("quality", a.quality).put("image_key", a.imageKey ?: "").put("state", a.state)
            .put("error", a.error ?: "").put("tracks", tracks).put("added_at", a.addedAt)
            .put("auto", a.auto)
        dir.mkdirs()
        val tmp = File(dir, "album.json.tmp")
        tmp.writeText(j.toString())
        tmp.renameTo(File(dir, "album.json"))
        index = null
        changed()
    }

    fun remove(c: Context, id: Int) {
        DownloadWorker.cancel(c, id)
        dirOf(c, id)?.deleteRecursively()
        index = null
        changed()
    }

    fun usedBytes(c: Context): Long =
        places(c).sumOf { p -> p.dir.walkTopDown().filter { it.isFile }.sumOf { it.length() } }

    /** What the album page shows for an album: state and progress. */
    fun status(c: Context, id: Int): JSONObject {
        val a = album(c, id) ?: return JSONObject().put("state", "none")
        return JSONObject().put("state", a.state).put("done", a.doneCount).put("total", a.tracks.size)
            .put("error", a.error ?: "").put("quality", a.quality)
    }

    // ------------------------------------------------------------ tracks

    @Volatile private var index: Map<Long, File>? = null

    /** The downloaded file for a library track, if it's on the phone. */
    fun trackFile(c: Context, trackId: Long?): File? {
        if (trackId == null) return null
        val idx = index ?: buildIndex(c).also { index = it }
        return idx[trackId]?.takeIf { it.exists() }
    }

    private fun buildIndex(c: Context): Map<Long, File> {
        val m = HashMap<Long, File>()
        for ((a, dir) in albums(c)) for (t in a.tracks) if (t.done) m[t.id] = File(dir, t.fileName())
        return m
    }

    // ------------------------------------------------------------ offline plays

    /** Plays made with no server, kept until they can be sent. */
    fun addPlay(c: Context, trackId: Long) {
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val a = runCatching { JSONArray(p.getString("plays", "[]")) }.getOrDefault(JSONArray())
        if (a.length() < 5000) a.put(JSONObject().put("track_id", trackId).put("ts", System.currentTimeMillis()))
        p.edit().putString("plays", a.toString()).apply()
    }

    fun pendingPlays(c: Context): JSONArray =
        runCatching { JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("plays", "[]")) }
            .getOrDefault(JSONArray())

    fun clearPlays(c: Context, sent: Int) {
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val a = pendingPlays(c)
        val rest = JSONArray()
        for (i in sent until a.length()) rest.put(a.get(i))
        p.edit().putString("plays", rest.toString()).apply()
    }
}
