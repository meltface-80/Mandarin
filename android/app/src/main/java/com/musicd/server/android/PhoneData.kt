package com.musicd.server.android

import android.content.Context
import com.musicd.server.client.PhoneAlbum
import com.musicd.server.client.PhoneMusic
import com.musicd.server.client.PhoneShelf
import com.musicd.server.client.PhoneTrack
import com.musicd.server.client.ShelfAlbum
import com.musicd.server.client.ShelfTrack
import org.json.JSONObject
import java.io.File

/*
 * What is on this phone, as core's PhoneShelf reads it (bug list item 106, O1): the finished downloads, each with the page
 * kept when it was downloaded, and the phone's own music as last read.
 */
internal object PhoneData {
    /** The library on this phone, read now. */
    fun shelf(c: Context): PhoneShelf {
        LocalMusic.load(c)
        return PhoneShelf(downloads(c), PhoneMusic(LocalMusic.albums.map(::phone), LocalMusic.folderName(c), LocalMusic.scanning, LocalMusic.scannedAt))
    }

    /** The finished downloads. */
    fun downloads(c: Context): List<ShelfAlbum> = DownloadStore.albums(c).filter { it.first.state == "done" }.map { (a, dir) -> shelf(a, dir) }

    /** Every download, finished or not (what the server is asked about). */
    fun everyDownload(c: Context): List<ShelfAlbum> = DownloadStore.albums(c).map { (a, dir) -> shelf(a, dir) }

    private fun shelf(a: DownloadStore.Album, dir: File) = ShelfAlbum(a.id, a.title, a.artist, a.year, a.imageKey, a.addedAt,
        a.tracks.map { ShelfTrack(it.id, it.title, it.duration) }, runCatching { JSONObject(File(dir, "page.json").readText()) }.getOrNull())

    /** One of the phone's own albums, as core reads it. */
    fun phone(a: LocalMusic.Album) = PhoneAlbum(a.key, a.title, a.artist, a.year, a.art != null,
        a.tracks.map { PhoneTrack(it.title, it.artist, it.duration, it.ext, it.rate, it.bits) })
}
