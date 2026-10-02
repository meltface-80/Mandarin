package com.musicd.server.android

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper

/**
 * Music files on the phone (Stage 5): the folder the user chose with
 * Android's document picker — a Qobuz purchase, say, waiting to be moved to
 * the server — read for its tags and covers, kept as a small index, shown in
 * the page as "On this phone", and played by the phone's player through its
 * DSP engine. Nothing else on the phone is read, and the server never sees
 * these files.
 *
 * The download folder (DownloadStore, chosen on its own since v0.5.41) is
 * left to the downloads code wherever it is, as is a `Mandarin` sub-folder
 * from before, when downloads lived inside this folder.
 *
 * The folder is read again whenever something in it may have changed: on
 * the app's return to the front, when Android reports a change in it, and
 * every few minutes while the app is open. A read is cheap when nothing
 * changed — a listing, the tags of unchanged files kept from last time — so
 * music added or taken away shows up or goes by itself.
 *
 * Albums are keyed by a hash of album artist and title, so a key is safe in
 * an address: the page knows an album as "phone:<key>" and its cover as
 * "phone-<key>".
 */
object LocalMusic {

    private const val TAG = "LocalMusic"
    const val SKIP_DIR = "Mandarin"
    private val AUDIO = setOf("flac", "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "aif", "aiff", "wv", "ape", "alac")
    private val COVERS = listOf("cover", "folder", "front", "album", "artwork")

    class Track(
        val uri: String, val name: String, val title: String, val artist: String,
        val disc: Int, val no: Int, val duration: Double, val ext: String,
        val size: Long, val mtime: Long, val rate: Int, val bits: Int,
        /** The album's tags from this file (kept in the index, so a re-read of an unchanged file costs nothing). */
        val album: String = "", val albumArtist: String = "", val year: Int? = null, val tagged: Boolean = false
    )

    class Album(
        val key: String, val title: String, val artist: String, val year: Int?,
        val art: String?,   // file name under local-art/, or null
        val tracks: List<Track>
    )

    @Volatile var albums: List<Album> = emptyList(); private set
    @Volatile var scanning = false; private set
    @Volatile private var again = false
    @Volatile var scannedAt = 0L; private set
    @Volatile var lastError: String? = null; private set
    @Volatile private var loaded = false
    private val pool = Executors.newSingleThreadExecutor()
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    fun listen(l: () -> Unit) { listeners += l }
    private fun changed() { for (l in listeners) runCatching { l() } }

    // ------------------------------------------------------------ the folder

    fun folder(c: Context): Uri? = Store.localFolder(c)?.let { Uri.parse(it) }

    /** The folder's own name, for the page ("Music", "Qobuz"). */
    fun folderName(c: Context): String? {
        val u = folder(c) ?: return null
        return runCatching {
            val doc = DocumentsContract.buildDocumentUriUsingTree(u, DocumentsContract.getTreeDocumentId(u))
            c.contentResolver.query(doc, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }
        }.getOrNull() ?: u.lastPathSegment?.substringAfterLast(':')?.substringAfterLast('/')
    }

    /** A folder chosen: kept (the permission is the activity's to take), and read now. */
    fun setFolder(c: Context, uri: Uri) {
        Store.setLocalFolder(c, uri.toString())
        if (watched != null) observe(c.applicationContext)
        rescan(c)
    }

    fun forget(c: Context) {
        folder(c)?.let { u -> runCatching { c.contentResolver.releasePersistableUriPermission(u, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
        Store.setLocalFolder(c, null)
        if (watched != null) observe(c.applicationContext)
        albums = emptyList(); scannedAt = 0L; lastError = null
        runCatching { indexFile(c).delete() }
        runCatching { artDir(c).listFiles()?.forEach { it.delete() } }
        changed()
    }

    /** Is the folder still there to read (its card in, its permission kept)? */
    fun available(c: Context): Boolean {
        val u = folder(c) ?: return false
        return c.contentResolver.persistedUriPermissions.any { it.uri == u && it.isReadPermission }
    }

    // ------------------------------------------------------------ watching

    private val main = Handler(Looper.getMainLooper())
    private var observer: ContentObserver? = null
    private var observedFor: String? = null
    /*
     * A read every half minute while the app is on screen, every three
     * minutes behind it. Android tells the app when it changes the folder
     * itself, but not reliably when another app (a file manager moving an
     * album to the server, say) takes files out — so the reads catch that.
     * A read of an unchanged folder is a listing, so it costs little.
     */
    private const val PERIOD_MS = 3 * 60_000L
    private const val PERIOD_FRONT_MS = 30_000L
    @Volatile private var front = false
    private fun period() = if (front) PERIOD_FRONT_MS else PERIOD_MS
    private val periodic = object : Runnable { override fun run() { watched?.let { c -> rescan(c) ; main.postDelayed(this, period()) } } }
    @Volatile private var watched: Context? = null

    /** The app came to the screen ([on]) or left it: the reads follow, and coming back reads now. */
    fun foreground(c: Context, on: Boolean) {
        front = on
        if (watched == null) return
        main.removeCallbacks(periodic)
        main.postDelayed(periodic, period())
        if (on) checkSoon(c)
    }

    /** From the activity's start to its end: Android's change notices for the folder, and a read every few minutes. */
    fun watch(c: Context) {
        watched = c.applicationContext
        observe(c.applicationContext)
        main.removeCallbacks(periodic)
        main.postDelayed(periodic, PERIOD_MS)
    }

    fun unwatch(c: Context) {
        main.removeCallbacks(periodic)
        observer?.let { runCatching { c.applicationContext.contentResolver.unregisterContentObserver(it) } }
        observer = null; observedFor = null
        watched = null
    }

    private fun observe(c: Context) {
        val u = folder(c)
        val key = u?.toString()
        if (key == observedFor) return
        observer?.let { runCatching { c.contentResolver.unregisterContentObserver(it) } }
        observer = null; observedFor = key
        if (u == null) return
        val o = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean, uri: Uri?) { checkSoon(c) }
        }
        runCatching {
            c.contentResolver.registerContentObserver(DocumentsContract.buildChildDocumentsUriUsingTree(u, DocumentsContract.getTreeDocumentId(u)), true, o)
            observer = o
        }.onFailure { Log.w(TAG, "observe: ${it.message}") }
    }

    private val check = Runnable { watched?.let { rescan(it) } }

    /** Read the folder again shortly (gathering a burst of notices into one read). */
    fun checkSoon(c: Context) {
        if (folder(c) == null) return
        if (watched == null) watched = c.applicationContext
        main.removeCallbacks(check)
        main.postDelayed(check, 1500)
    }

    // ------------------------------------------------------------ the index

    private fun indexFile(c: Context) = File(c.filesDir, "local-music.json")
    private fun artDir(c: Context) = File(c.filesDir, "local-art").apply { mkdirs() }
    fun art(c: Context, key: String): File? = album(key)?.art?.let { File(artDir(c), it) }?.takeIf { it.exists() }

    fun album(key: String): Album? = albums.firstOrNull { it.key == key }

    /** The index from disk, once; a scan if the folder has never been read. */
    fun load(c: Context) {
        if (loaded) return
        loaded = true
        runCatching {
            val j = JSONObject(indexFile(c).readText())
            scannedAt = j.optLong("scanned_at")
            albums = parse(j.optJSONArray("albums") ?: JSONArray())
        }
        if (folder(c) != null && scannedAt == 0L) rescan(c)
    }

    private fun save(c: Context) {
        val a = JSONArray()
        for (al in albums) {
            val ts = JSONArray()
            for (t in al.tracks) ts.put(JSONObject().put("uri", t.uri).put("name", t.name).put("title", t.title).put("artist", t.artist)
                .put("disc", t.disc).put("no", t.no).put("duration", t.duration).put("ext", t.ext).put("size", t.size).put("mtime", t.mtime)
                .put("rate", t.rate).put("bits", t.bits)
                .put("album", t.album).put("album_artist", t.albumArtist).put("year", t.year ?: JSONObject.NULL).put("tagged", t.tagged))
            a.put(JSONObject().put("key", al.key).put("title", al.title).put("artist", al.artist).put("year", al.year ?: JSONObject.NULL)
                .put("art", al.art ?: JSONObject.NULL).put("tracks", ts))
        }
        runCatching { indexFile(c).writeText(JSONObject().put("scanned_at", scannedAt).put("albums", a).toString()) }
    }

    private fun parse(a: JSONArray): List<Album> = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        val ts = o.optJSONArray("tracks") ?: JSONArray()
        Album(o.getString("key"), o.optString("title"), o.optString("artist"), if (o.isNull("year")) null else o.optInt("year"),
            if (o.isNull("art")) null else o.optString("art"),
            (0 until ts.length()).map { k ->
                val t = ts.getJSONObject(k)
                Track(t.getString("uri"), t.optString("name"), t.optString("title"), t.optString("artist"), t.optInt("disc", 1), t.optInt("no", 0),
                    t.optDouble("duration", 0.0), t.optString("ext"), t.optLong("size"), t.optLong("mtime"), t.optInt("rate"), t.optInt("bits"),
                    t.optString("album"), t.optString("album_artist"), if (t.isNull("year")) null else t.optInt("year"), t.optBoolean("tagged", false))
            })
    }

    // ------------------------------------------------------------ the scan

    /**
     * Read the folder again, in the background; files unchanged since last
     * time keep their tags, so a read of an unchanged folder is a listing.
     * A change is told to the page (the Home row, the settings); none isn't.
     */
    fun rescan(c: Context) {
        // Asked while reading: once more when this read ends, so the last
        // change is always read (an album moved out file by file sends
        // notices while the first read is still going; they were dropped).
        if (scanning) { again = true; return }
        val tree = folder(c) ?: return
        if (!available(c)) return   // its card out, say: what was read is kept until it is back
        scanning = true; lastError = null
        val before = signature()
        if (before == null) changed()   // the first read: the page shows "reading"
        pool.execute {
            try {
                val known = HashMap<String, Track>()
                for (al in albums) for (t in al.tracks) known[t.uri] = t
                val found = ArrayList<Pair<Track, String>>()   // track, its folder's document id
                val covers = HashMap<String, String>()          // folder document id → cover document uri
                val skip = skipDocId(c)
                walk(c, tree, DocumentsContract.getTreeDocumentId(tree), 0, known, found, covers, skip)
                albums = group(c, found, covers)
                scannedAt = System.currentTimeMillis()
                save(c)
                Log.i(TAG, "${albums.size} albums, ${found.size} tracks")
            } catch (e: Exception) {
                lastError = e.message ?: "couldn't read the folder"
                Log.w(TAG, "scan: ${e.message}")
            } finally {
                scanning = false
                if (before == null || before != signature() || lastError != null) changed()
                if (again) { again = false; main.post { rescan(c) } }
            }
        }
    }

    /** What the page would show: the albums and their tracks, as one string; null before the first read. */
    private fun signature(): String? = if (scannedAt == 0L) null else albums.joinToString("|") { a -> a.key + ":" + a.tracks.size + ":" + a.art }

    /** The download folder's document id when it is inside this folder (its albums are the downloads', not this list's). */
    private fun skipDocId(c: Context): String? {
        val d = DownloadStore.downloadFolderUri(c) ?: return null
        val id = runCatching { DocumentsContract.getTreeDocumentId(d) }.getOrNull() ?: return null
        val sub = Store.downloadSub(c)
        return if (sub.isEmpty()) id else "$id/$sub"
    }

    private fun walk(c: Context, tree: Uri, docId: String, depth: Int, known: Map<String, Track>,
                     out: MutableList<Pair<Track, String>>, covers: MutableMap<String, String>, skip: String?) {
        if (depth > 8) return
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        c.contentResolver.query(children, cols, null, null, null)?.use { cur ->
            while (cur.moveToNext()) {
                val id = cur.getString(0); val name = cur.getString(1) ?: continue
                val mime = cur.getString(2) ?: ""; val size = cur.getLong(3); val mtime = cur.getLong(4)
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (depth == 0 && name.equals(SKIP_DIR, ignoreCase = true)) continue
                    if (skip != null && (id == skip || id.equals(skip, ignoreCase = true))) continue
                    walk(c, tree, id, depth + 1, known, out, covers, skip)
                    continue
                }
                val ext = name.substringAfterLast('.', "").lowercase()
                val base = name.substringBeforeLast('.').lowercase()
                if (ext in setOf("jpg", "jpeg", "png", "webp") && base in COVERS && !covers.containsKey(docId)) {
                    covers[docId] = DocumentsContract.buildDocumentUriUsingTree(tree, id).toString()
                    continue
                }
                if (ext !in AUDIO) continue
                val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                val old = known[uri.toString()]
                val t = if (old != null && old.size == size && old.mtime == mtime && old.tagged) old else read(c, uri, name, ext, size, mtime)
                out += t to docId
            }
        }
    }

    /** One file's tags. */
    private fun read(c: Context, uri: Uri, name: String, ext: String, size: Long, mtime: Long): Track {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(c, uri)
            val get = { k: Int -> r.extractMetadata(k)?.trim()?.takeIf { it.isNotEmpty() } }
            val num = { s: String? -> s?.substringBefore('/')?.trim()?.toIntOrNull() ?: 0 }
            val title = get(MediaMetadataRetriever.METADATA_KEY_TITLE) ?: name.substringBeforeLast('.')
            val artist = get(MediaMetadataRetriever.METADATA_KEY_ARTIST) ?: get(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST) ?: ""
            val duration = (get(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0
            val rate = if (Build.VERSION.SDK_INT >= 31) get(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull() ?: 0 else 0
            val bits = if (Build.VERSION.SDK_INT >= 31) get(MediaMetadataRetriever.METADATA_KEY_BITS_PER_SAMPLE)?.toIntOrNull() ?: 0 else 0
            val year = (get(MediaMetadataRetriever.METADATA_KEY_YEAR) ?: get(MediaMetadataRetriever.METADATA_KEY_DATE))
                ?.let { Regex("\\d{4}").find(it)?.value?.toIntOrNull() }
            return Track(uri.toString(), name, title, artist, num(get(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)).coerceAtLeast(1),
                num(get(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)), duration, ext, size, mtime, rate, bits,
                get(MediaMetadataRetriever.METADATA_KEY_ALBUM) ?: "", get(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST) ?: "", year, true)
        } catch (e: Exception) {
            return Track(uri.toString(), name, name.substringBeforeLast('.'), "", 1, 0, 0.0, ext, size, mtime, 0, 0, "", "", null, true)
        } finally { runCatching { r.release() } }
    }

    /** The album each track belongs to (album artist and album, from the tags), with its cover. */
    private fun group(c: Context, found: List<Pair<Track, String>>, covers: Map<String, String>): List<Album> {
        // The album's own tags (album, album artist, year) are read per file
        // here; the index keeps only the track's fields.
        val byKey = LinkedHashMap<String, MutableList<Pair<Track, String>>>()
        val tagsOf = HashMap<String, TagsHolder>()
        for ((t, folderId) in found) {
            // The album's tags travel with the track (read once, kept in the index).
            val tags = tagsOf.getOrPut(t.uri) { TagsHolder(t.album.ifEmpty { folderId.substringAfterLast('/').substringAfterLast(':') }, t.albumArtist, t.year) }
            val key = keyOf(tags.albumArtist.ifEmpty { t.artist }, tags.album)
            byKey.getOrPut(key) { ArrayList() } += t to folderId
        }
        val out = ArrayList<Album>()
        val artDir = artDir(c)
        val keep = HashSet<String>()
        for ((key, list) in byKey) {
            val first = list.first().first
            val tags = tagsOf[first.uri]!!
            val tracks = list.map { it.first }.sortedWith(compareBy({ it.disc }, { it.no }, { it.name.lowercase() }))
            val artists = tracks.map { it.artist }.filter { it.isNotEmpty() }.distinct()
            val artist = tags.albumArtist.ifEmpty { if (artists.size == 1) artists[0] else if (artists.size > 1) "Various Artists" else "" }
            val artName = cover(c, key, Uri.parse(first.uri), list.first().second, covers, artDir)
            artName?.let { keep += it }
            out += Album(key, tags.album.ifEmpty { "Unknown album" }, artist, tags.year, artName, tracks)
        }
        artDir.listFiles()?.forEach { if (it.name !in keep) it.delete() }
        return out.sortedBy { it.title.lowercase() }
    }

    private class TagsHolder(val album: String, val albumArtist: String, val year: Int?)

    private fun keyOf(artist: String, album: String): String {
        val s = (artist.lowercase().trim() + "|" + album.lowercase().trim())
        val d = MessageDigest.getInstance("SHA-1").digest(s.toByteArray())
        return d.joinToString("") { "%02x".format(it) }.substring(0, 16)
    }

    /** The cover: the first track's embedded picture, else a cover file beside it. Kept under local-art/. */
    private fun cover(c: Context, key: String, first: Uri, folderId: String, covers: Map<String, String>, dir: File): String? {
        val existing = dir.listFiles()?.firstOrNull { it.name.startsWith("$key.") }
        if (existing != null) return existing.name
        val bytes: ByteArray? = runCatching {
            val r = MediaMetadataRetriever()
            try { r.setDataSource(c, first); r.embeddedPicture } finally { runCatching { r.release() } }
        }.getOrNull() ?: covers[folderId]?.let { u -> runCatching { c.contentResolver.openInputStream(Uri.parse(u))?.use { it.readBytes() } }.getOrNull() }
        if (bytes == null || bytes.size < 100) return null
        val ext = if (bytes.size > 8 && bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte()) "png" else "jpg"
        val f = File(dir, "$key.$ext")
        runCatching { f.writeBytes(bytes) }.onFailure { return null }
        return f.name
    }

    // ------------------------------------------------------------ for the page and the player

    fun albumJson(a: Album): JSONObject = JSONObject()
        .put("key", a.key).put("offset", "phone:${a.key}").put("title", a.title).put("subtitle", a.artist)
        .put("image_key", if (a.art != null) "phone-${a.key}" else JSONObject.NULL).put("source", "local")
        .put("tracks", a.tracks.size).put("year", a.year ?: JSONObject.NULL)
        // The tile's badge, as the server shapes it: "24/96" (hi-res marked) or the lossy format.
        .put("quality", quality(a) ?: JSONObject.NULL).put("hires", hires(a))

    private fun quality(a: Album): String? {
        val t = a.tracks.firstOrNull() ?: return null
        val lossless = t.ext in setOf("flac", "wav", "aif", "aiff", "alac", "wv", "ape")
        if (!lossless) return t.ext.uppercase()
        if (t.rate <= 0 || t.bits <= 0) return null
        val khz = if (t.rate % 1000 == 0) (t.rate / 1000).toString() else String.format("%.1f", t.rate / 1000.0)
        return "${t.bits}/$khz"
    }
    private fun hires(a: Album): Boolean = a.tracks.firstOrNull()?.let { it.rate > 48000 || it.bits > 16 } ?: false

    /** The album's page, as the server shapes one (OfflineApi.albumPage). */
    fun albumPage(a: Album): JSONObject {
        val tracks = JSONArray()
        for (t in a.tracks) {
            val len = t.duration.toInt()
            tracks.put(JSONObject().put("title", t.title).put("subtitle", "%d:%02d".format(len / 60, len % 60))
                .put("length", len).put("track_id", JSONObject.NULL).put("artist", t.artist)
                .put("quality", if (t.rate > 0 && t.bits > 0) "${t.bits}/${if (t.rate % 1000 == 0) (t.rate / 1000).toString() else String.format("%.1f", t.rate / 1000.0)}" else JSONObject.NULL))
        }
        return JSONObject().put("album", albumJson(a)).put("tracks", tracks)
            .put("actions", JSONArray(listOf("play_now" to "Play Now", "queue" to "Queue", "play_next" to "Play Next", "shuffle" to "Shuffle")
                .map { JSONObject().put("kind", it.first).put("title", it.second) }))
            .put("offset", "phone:${a.key}").put("artists", JSONArray().put(a.artist))
            .put("library_moved", false).put("partial", false).put("declared_tracks", tracks.length()).put("on_phone", true)
    }

    fun mediaItems(c: Context, key: String): List<MediaItem> {
        val a = album(key) ?: return emptyList()
        val art = art(c, key)?.let { Uri.fromFile(it) }
        return a.tracks.map { t ->
            MediaItem.Builder()
                .setUri(Uri.parse(t.uri))
                .setMediaId("phone:" + t.uri)
                .setMediaMetadata(MediaMetadata.Builder()
                    .setTitle(t.title).setArtist(t.artist.ifEmpty { a.artist }).setAlbumTitle(a.title)
                    .apply { art?.let { setArtworkUri(it) } }
                    .setExtras(Bundle().apply {
                        putInt(PhonePlayerService.EXTRA_ALBUM, -1)
                        putString("album_key", a.key)
                        putString("image_key", if (a.art != null) "phone-${a.key}" else null)
                        putDouble("duration", t.duration)
                        putString("ext", t.ext)
                    })
                    .build())
                .build()
        }
    }
}
