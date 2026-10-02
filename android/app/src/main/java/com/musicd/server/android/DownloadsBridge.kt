package com.musicd.server.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.musicd.server.client.CachePlan
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the server's page can ask of the app about downloads — only inside
 * this app; the page offers nothing when the bridge isn't there, so browsers
 * and the iPhone home-screen app are unchanged.
 *
 *   MusicdDownloads.status(albumId)   → {"state": none|queued|downloading|waiting|done|failed, …}
 *   MusicdDownloads.download(albumId, title, artist)   asks Original / Opus 256, then queues it
 *   MusicdDownloads.remove(albumId)   asks, then deletes it from the phone
 *   MusicdDownloads.removeMany(ids)   deletes these (a JSON array) — the page has asked
 *   MusicdDownloads.open()            the Downloads screen
 *   MusicdDownloads.ids()             albums fully on the phone, as a JSON array
 *   MusicdDownloads.all()             every album on the phone or on its way, newest first:
 *                                     [{"id", "state", "done", "total", "title", "artist",
 *                                       "quality", "bytes", "auto", "error", "image_key"}, …]
 *   MusicdDownloads.settings()        the download settings, the places to save to, space used
 *   MusicdDownloads.set(key, value)   change one setting (quality, location, wifiOnly, limitGb,
 *                                     autoPicks, autoAotd, autoRecent, awayQuality)
 *   MusicdDownloads.chooseDownloadFolder()  the download folder, picked on its own (v0.5.41)
 *   MusicdDownloads.forgetDownloadFolder()
 *   MusicdDownloads.play(albumId)     play a downloaded album on this phone (through the
 *                                     server when it's in reach, so the page shows it)
 *
 * Music files on the phone (LocalMusic, Stage 5):
 *   MusicdDownloads.localFolder()     {"name", "albums", "tracks", "scanning", "scanned_at", "available", "error"} or null
 *   MusicdDownloads.chooseLocalFolder()   Android's folder picker
 *   MusicdDownloads.forgetLocalFolder()
 *   MusicdDownloads.rescanLocal()
 *   MusicdDownloads.localAlbums()     [{"key", "offset": "phone:<key>", "title", "subtitle", "image_key", "tracks", "year"}, …]
 *   MusicdDownloads.playLocal(key, index, kind)   play an album on this phone: index −1 for the whole
 *                                     album, else that track; kind play_now | queue | add_next | shuffle
 *
 * And the other way: whenever a download starts, moves on, finishes or is
 * removed, the app calls window.__musicdDownloadsChanged() on the page
 * (MainActivity), so what it shows follows along without a reload; the
 * phone's own music likewise, window.__musicdLocalChanged().
 */
class DownloadsBridge(private val activity: Activity) {

    companion object { const val NAME = "MusicdDownloads" }

    @JavascriptInterface
    fun status(albumId: Int): String = DownloadStore.status(activity, albumId).toString()

    @JavascriptInterface
    fun ids(): String {
        val a = JSONArray()
        for ((album, _) in DownloadStore.albums(activity)) if (album.state == "done") a.put(album.id)
        return a.toString()
    }

    @JavascriptInterface
    fun all(): String {
        val a = JSONArray()
        for ((album, _) in DownloadStore.albums(activity)) {
            a.put(JSONObject().put("id", album.id).put("state", album.state)
                .put("done", album.doneCount).put("total", album.tracks.size)
                .put("title", album.title).put("artist", album.artist).put("quality", album.quality)
                .put("bytes", album.totalBytes).put("auto", album.auto).put("error", album.error ?: "")
                .put("image_key", album.imageKey ?: ""))
        }
        // Albums in the music folder while its card is out: shown as away, not lost.
        val away = DownloadStore.awayAlbums(activity)
        for (i in 0 until away.length()) {
            val o = away.getJSONObject(i)
            a.put(JSONObject().put("id", o.optInt("id")).put("state", "away").put("done", o.optInt("total")).put("total", o.optInt("total"))
                .put("title", o.optString("title")).put("artist", o.optString("artist")).put("quality", o.optString("quality"))
                .put("bytes", o.optLong("bytes")).put("auto", false).put("error", "").put("image_key", o.optString("image_key")))
        }
        return a.toString()
    }

    /** Android's "all files" access: the system page where it is granted. */
    @JavascriptInterface
    fun allowAllFiles() { activity.runOnUiThread { (activity as? MainActivity)?.openAllFilesAccess() } }

    /** The download folder (v0.5.41): Android's folder picker, on its own; and forgotten. */
    @JavascriptInterface
    fun chooseDownloadFolder() { activity.runOnUiThread { (activity as? MainActivity)?.pickDownloadFolder() } }

    @JavascriptInterface
    fun forgetDownloadFolder() { DownloadStore.forgetDownloadFolder(activity) }

    /** Every downloaded album moved to the place chosen under Save to. */
    @JavascriptInterface
    fun moveDownloads() { DownloadStore.moveAll(activity, DownloadStore.settings(activity).location) }

    @JavascriptInterface
    fun settings(): String {
        val s = DownloadStore.settings(activity)
        val places = JSONArray()
        for (p in DownloadStore.places(activity)) {
            places.put(JSONObject().put("id", p.id).put("label", p.label).put("free", p.freeBytes))
        }
        // The music folder as a place to save to (v0.5.27): chosen or not, and
        // whether the app may write there yet; albums elsewhere than the
        // chosen place, for "Move all here"; a move under way.
        val access = DownloadStore.folderAccess(activity)
        val target = DownloadStore.target(activity)
        val elsewhere = DownloadStore.albums(activity).count { (a, dir) -> a.state == "done" && dir.parentFile?.canonicalPath != target.dir.canonicalPath }
        val mv = DownloadStore.moving
        return JSONObject()
            .put("quality", s.quality).put("location", s.location).put("wifiOnly", s.wifiOnly)
            .put("limitGb", s.limitGb).put("autoPicks", s.autoPicks).put("autoAotd", s.autoAotd)
            .put("autoRecent", s.autoRecent).put("awayQuality", s.awayQuality).put("places", places)
            .put("folder", JSONObject().put("access", access).put("name", DownloadStore.folderName(activity) ?: "")
                .put("path", DownloadStore.folderPath(activity)?.path ?: "").put("chosen", access != "none"))
            .put("elsewhere", elsewhere)
            .put("moving", if (mv == null) JSONObject.NULL else JSONObject().put("to", mv.to).put("done", mv.done).put("total", mv.total).put("error", mv.error ?: ""))
            .put("used", DownloadStore.usedBytesQuick(activity))
            .put("cacheWifi", s.cacheWifi).put("cacheMobile", s.cacheMobile).put("cacheGb", s.cacheGb)
            .put("cacheChoices", JSONObject()
                .put("wifi", JSONArray(CachePlan.WIFI_CHOICES)).put("mobile", JSONArray(CachePlan.MOBILE_CHOICES))
                .put("gb", JSONArray(CachePlan.SIZE_CHOICES_GB)))
            .toString()
    }

    /** The cache of tracks played on the phone: {"used", "ahead", "wanted", "metered"}. */
    @JavascriptInterface
    fun cacheStatus(): String {
        val a = PhonePlayerService.ahead
        return JSONObject().put("used", StreamCache.usedBytes(activity))
            .put("ahead", a.cached).put("wanted", a.wanted).put("metered", a.metered)
            .toString()
    }

    @JavascriptInterface
    fun clearCache() {
        StreamCache.clear(activity)
        PhonePlayerService.current?.fetchAheadSoon()
    }

    @JavascriptInterface
    fun set(key: String, value: String) {
        val c = activity
        when (key) {
            "quality" -> DownloadStore.setQuality(c, if (value == DownloadStore.QUALITY_OPUS) value else DownloadStore.QUALITY_ORIGINAL)
            "location" -> DownloadStore.setLocation(c, value)
            "wifiOnly" -> {
                DownloadStore.setWifiOnly(c, value == "true")
                // Downloads already waiting take the new rule now (mobile data, or Wi-Fi only).
                for ((a, _) in DownloadStore.albums(c)) if (a.state != "done")
                    DownloadWorker.enqueue(c, a.id, a.quality, a.title, a.artist, a.auto)
                AutoDownloads.reschedule(c)
            }
            "awayQuality" -> DownloadStore.setAwayQuality(c, if (value == DownloadStore.QUALITY_ORIGINAL) value else DownloadStore.QUALITY_OPUS)
            "limitGb" -> DownloadStore.setLimitGb(c, value.toIntOrNull() ?: 0)
            "cacheWifi" -> { DownloadStore.setCacheWifi(c, value.toIntOrNull() ?: CachePlan.WIFI_DEFAULT); PhonePlayerService.current?.fetchAheadSoon() }
            "cacheMobile" -> { DownloadStore.setCacheMobile(c, value.toIntOrNull() ?: CachePlan.MOBILE_DEFAULT); PhonePlayerService.current?.fetchAheadSoon() }
            "cacheGb" -> {
                val gb = CachePlan.pick(value.toIntOrNull() ?: 0, CachePlan.SIZE_CHOICES_GB, CachePlan.SIZE_DEFAULT_GB)
                DownloadStore.setCacheGb(c, gb)
                StreamCache.setLimit(c, gb)
            }
            "autoPicks" -> { DownloadStore.setAutoPicks(c, value == "true"); AutoDownloads.runNow(c) }
            "autoAotd" -> { DownloadStore.setAutoAotd(c, value == "true"); AutoDownloads.runNow(c) }
            "autoRecent" -> { DownloadStore.setAutoRecent(c, value.toIntOrNull() ?: 0); AutoDownloads.runNow(c) }
        }
    }

    @JavascriptInterface
    fun play(albumId: Int) {
        activity.startService(Intent(activity, PhonePlayerService::class.java)
            .setAction(PhonePlayerService.ACTION_PLAY_LOCAL)
            .putExtra(PhonePlayerService.EXTRA_ALBUM, albumId)
            .putExtra(PhonePlayerService.EXTRA_INDEX, 0))
    }

    // ------------------------------------------------------------ music on the phone

    @JavascriptInterface
    fun localFolder(): String {
        LocalMusic.load(activity)
        if (Store.localFolder(activity) == null) return "null"
        return JSONObject().put("name", LocalMusic.folderName(activity) ?: "Folder")
            .put("albums", LocalMusic.albums.size).put("tracks", LocalMusic.albums.sumOf { it.tracks.size })
            .put("scanning", LocalMusic.scanning).put("scanned_at", LocalMusic.scannedAt)
            .put("available", LocalMusic.available(activity)).put("error", LocalMusic.lastError ?: "").toString()
    }

    @JavascriptInterface
    fun chooseLocalFolder() { activity.runOnUiThread { (activity as? MainActivity)?.pickLocalFolder() } }

    @JavascriptInterface
    fun forgetLocalFolder() { LocalMusic.forget(activity) }

    @JavascriptInterface
    fun rescanLocal() { LocalMusic.rescan(activity, force = true) }   // Rescan: files whose tags couldn't be read are tried again

    @JavascriptInterface
    fun localAlbums(): String {
        LocalMusic.load(activity)
        val a = JSONArray()
        for (al in LocalMusic.albums) a.put(LocalMusic.albumJson(al))
        return a.toString()
    }

    @JavascriptInterface
    fun playLocal(key: String, index: Int, kind: String) {
        activity.startService(Intent(activity, PhonePlayerService::class.java)
            .setAction(PhonePlayerService.ACTION_PLAY_PHONE)
            .putExtra(PhonePlayerService.EXTRA_KEY, key)
            .putExtra(PhonePlayerService.EXTRA_INDEX, index)
            .putExtra(PhonePlayerService.EXTRA_KIND, kind))
    }

    @JavascriptInterface
    fun download(albumId: Int, title: String, artist: String) {
        activity.runOnUiThread { askQuality(albumId, title, artist) }
    }

    @JavascriptInterface
    fun remove(albumId: Int) {
        activity.runOnUiThread {
            val a = DownloadStore.album(activity, albumId) ?: return@runOnUiThread
            AlertDialog.Builder(activity)
                .setTitle("Remove from this phone?")
                .setMessage("${a.title} — ${a.artist}\n\nIt stays in your library on the server.")
                .setPositiveButton("Remove") { _, _ ->
                    DownloadStore.removeInBackground(activity, listOf(albumId)) {
                        activity.runOnUiThread { Toast.makeText(activity, "Removed from this phone", Toast.LENGTH_SHORT).show() }
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    /**
     * Several albums off the phone at once, without asking again: the page's
     * Downloads list has just asked (one, the ones selected, or all). [idsJson]:
     * a JSON array of album ids. Downloads under way are stopped first.
     */
    @JavascriptInterface
    fun removeMany(idsJson: String) {
        val ids = runCatching { JSONArray(idsJson) }.getOrNull() ?: return
        val list = (0 until ids.length()).map { ids.optInt(it) }.filter { it > 0 }
        if (list.isEmpty()) return
        // Deleted in the background (stopping each one's download too): gigabytes
        // of files deleted on the screen thread froze the app.
        DownloadStore.removeInBackground(activity, list) {
            activity.runOnUiThread {
                Toast.makeText(activity,
                    if (list.size == 1) "Removed from this phone" else "${list.size} albums removed from this phone",
                    Toast.LENGTH_SHORT).show()
            }
        }
    }

    @JavascriptInterface
    fun open() {
        activity.runOnUiThread { activity.startActivity(Intent(activity, DownloadsActivity::class.java)) }
    }

    private fun askQuality(albumId: Int, title: String, artist: String) {
        val options = arrayOf("Original — the files as they are", "Opus 256 kbps — about a tenth of the size")
        val values = arrayOf(DownloadStore.QUALITY_ORIGINAL, DownloadStore.QUALITY_OPUS)
        var chosen = values.indexOf(DownloadStore.settings(activity).quality).coerceAtLeast(0)
        val s = DownloadStore.settings(activity)
        val where = DownloadStore.target(activity).label + if (s.wifiOnly) " · on Wi-Fi" else ""
        AlertDialog.Builder(activity)
            .setTitle("Download to this phone")
            .setSingleChoiceItems(options, chosen) { _, which -> chosen = which }
            .setPositiveButton("Download") { _, _ ->
                DownloadWorker.enqueue(activity, albumId, values[chosen], title, artist)
                Toast.makeText(activity, "Downloading $title — $where", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
