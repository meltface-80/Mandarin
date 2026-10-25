package com.musicd.server.client

import java.io.File

/**
 * The downloaded albums' folders on the phone (bug list item 191): one per album, named by its id and holding its
 * album.json, in each place downloads go.
 *
 * An album removed while it was downloading came back: its folder was deleted, but the download still running wrote
 * album.json again at the end of its track (or as it stopped), folder and all. A download's writes now go through
 * [whileKept], which writes only while the album is still there, and [remove] takes album.json away first under the same
 * lock, so no write comes between. And the space downloads take ([usedBytes]) was every file under each place: a chosen
 * download folder's other music, half-downloaded .part files, folders waiting to be deleted. It is the albums' own files
 * now.
 */
object DownloadDirs {
    private val lock = Any()

    /** [write] run on the album at [dir] only while it is still on the phone (not removed meanwhile): false when it was not. */
    fun whileKept(dir: File, write: () -> Unit): Boolean = synchronized(lock) {
        if (!File(dir, "album.json").exists()) return false
        write()
        true
    }

    /** The album at [dir] off the phone: gone at once for a download's writes ([whileKept]), its files deleted after. */
    fun remove(dir: File) {
        synchronized(lock) { File(dir, "album.json").delete() }
        dir.deleteRecursively()
    }

    /** The bytes the albums in [places] take: the files of each album's folder, not a .part still coming in, nor anything else there. */
    fun usedBytes(places: List<File>): Long =
        places.sumOf { p ->
            (p.listFiles() ?: emptyArray()).filter { it.isDirectory && it.name.toIntOrNull() != null && File(it, "album.json").isFile }
                .sumOf { album -> (album.listFiles() ?: emptyArray()).filter { it.isFile && !it.name.endsWith(".part") }.sumOf { it.length() } }
        }
}
