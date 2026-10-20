package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

private fun <T> JSONArray?.items(parse: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(parse) }

/** One of the server's music folders (GET /api/library/folders), and what the page says of it. */
data class MusicFolder(val name: String, val path: String, val exists: Boolean, val readable: Boolean, val tracks: Int, val hint: String?) {
    /** Not there, or not readable: said in red. */
    val bad: Boolean get() = !exists || !readable

    /** How many tracks it has (in the phone's way of writing numbers), or that it isn't there or can't be read. */
    fun state(locale: Locale = Locale.getDefault()): String = when {
        !exists -> "Not there — its albums are kept"
        !readable -> "Can’t be read — its albums are kept"
        else -> NumberFormat.getIntegerInstance(locale).format(tracks) + " tracks"
    }
}

/** A drive or share the server sees ([waiting]: not mounted yet). */
data class Mount(val path: String, val waiting: Boolean)

/** The server's folders: [scanning] while it reads them, [docker] when it runs in a container (the note says what to mount). */
data class MusicFolders(val folders: List<MusicFolder>, val scanning: Boolean, val docker: Boolean, val mounts: List<Mount>) {
    /** Remove is offered only where there is another folder to keep. */
    val removable: Boolean get() = folders.size > 1
}

/** One folder of the server's, browsed for one to add (GET /api/library/browse): where it is, the one above, the folders in it. */
data class Browsed(val path: String, val parent: String?, val dirs: List<Pair<String, String>>, val hint: String?)

/** The phone's own folder of music (the app's LocalMusic), as the block under the server's folders shows it. */
data class LocalFolder(val name: String, val albums: Int, val tracks: Int, val scanning: Boolean, val scannedAt: Long, val available: Boolean, val error: String?)

/**
 * Settings → Music Folders (the page's settings-folders.js and android-downloads.js localFolderBlock; bug list item 88): the
 * server's folders, choosing one to add, and the phone's own, in the page's words.
 */
object FolderSettings {
    fun parse(j: JSONObject): MusicFolders = MusicFolders(
        j.optJSONArray("folders").items { f ->
            MusicFolder(f.optString("name").ifEmpty { f.optString("path") }, f.optString("path"), f.optBoolean("exists", true), f.optBoolean("readable", true),
                f.optInt("tracks"), f.optString("hint").takeIf { it.isNotEmpty() && it != "null" })
        },
        j.optBoolean("scanning"), j.optBoolean("docker"),
        j.optJSONArray("mounts").items { m -> Mount(m.optString("path"), m.optBoolean("waiting")) })

    /** The folders after an add or a remove ([j]: the server's answer), what it doesn't say kept from [was] (the page's Object.assign). */
    fun after(was: MusicFolders, j: JSONObject): MusicFolders = MusicFolders(
        if (j.has("folders")) parse(j).folders else was.folders,
        if (j.has("scanning")) j.optBoolean("scanning") else was.scanning, was.docker, was.mounts)

    fun browsed(j: JSONObject): Browsed = Browsed(j.optString("path", "/"), j.optString("parent").takeIf { !j.isNull("parent") && it.isNotEmpty() },
        j.optJSONArray("dirs").items { d -> d.optString("name") to d.optString("path") }, j.optString("hint").takeIf { it.isNotEmpty() && it != "null" })

    /** The folder in the library that [path] is, or is inside; none when it can be added. */
    fun inside(folders: MusicFolders?, path: String): String? =
        folders?.folders?.map { it.path }?.firstOrNull { path == it || path.startsWith("$it/") }

    /** The add button's words: the folder's last name, or its path at the top. */
    fun chooseWords(path: String): String = "Add “" + (path.split("/").lastOrNull { it.isNotEmpty() } ?: path) + "”"

    /** What is said under the folders: in a container, what to mount (its bold parts true); else that any folder will do. */
    fun note(docker: Boolean): List<Pair<String, Boolean>> = if (docker) listOf(
        "The server sees only what its container has mounted. Mount your drives and shares once — e.g. " to false, "-v /mnt:/mnt:ro,rslave" to true,
        " (on DietPi, everything in Drive Manager is under /mnt; " to false, "rslave" to true,
        " lets shares the machine mounts later show up) — and add any folders in them here. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums." to false)
    else listOf("Any folder on the machine the server runs on. A folder that’s missing for a while (a drive asleep, a share that dropped) keeps its albums." to false)

    fun removeQuestion(f: MusicFolder, locale: Locale = Locale.getDefault()): String =
        "Remove “${f.name}” from the library?\n\nIts ${NumberFormat.getIntegerInstance(locale).format(f.tracks)} tracks and their albums leave Mandarin. The files themselves aren’t touched."

    fun removed(f: MusicFolder, j: JSONObject, locale: Locale = Locale.getDefault()): String =
        "Removed “${f.name}” — ${NumberFormat.getIntegerInstance(locale).format(j.optInt("removed"))} tracks"

    /** What is said of the phone's folder under its name ([at]: a moment, milliseconds, as the phone writes it). */
    fun localState(l: LocalFolder, at: (Long) -> String): String = when {
        l.scanning -> "Reading the folder…"
        !l.available -> "Not reachable right now — its card may be out"
        else -> "${l.albums} album" + (if (l.albums == 1) "" else "s") + " · ${l.tracks} track" + (if (l.tracks == 1) "" else "s") + " · read " + (if (l.scannedAt > 0) at(l.scannedAt) else "never")
    }

    const val SCANNING = "Reading your music… new albums appear as they’re found."
    const val ADDED = "Added — reading its music now"
    const val NO_FOLDERS = "No folders in here."
    const val PLACES = "Mounted drives and shares"
    const val TAG = "In the library"
    const val UNREACHABLE = "Couldn’t ask the server."
    const val LOCAL_INFO = "Music bought on this phone (a Qobuz purchase, say) in a folder of your choosing. Mandarin reads its tags and covers, shows it on Home as “Music on device”, and plays it here through the phone’s DSP. The folder is read again by itself when it changes, when the app comes back, and every few minutes. Forget stops Mandarin reading it; nothing in it is touched."
    const val LOCAL_NONE_NOTE = "Music already on the phone, in a folder you choose."
    const val FORGET_QUESTION = "Forget this folder?\n\nMandarin stops reading it. Nothing in it is deleted."
}
