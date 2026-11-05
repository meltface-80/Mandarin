package com.musicd.server.client

import java.security.MessageDigest

/**
 * Which album each of the phone's own tracks is (item 279): its album artist and title, and its folder, as the
 * server keys an album of its library (Scanner.cs: artist, title and folder). Two folders with the same tags — Deep
 * Purple's Machine Head (1972), (Remastered 2012) and (2024 Remix), each in its own folder, all tagged "Machine Head" —
 * are three albums, not one of 31 tracks. A disc folder (CD1, Disc 2, Side A's "Side 1"…) is its parent's, so the
 * discs of one album in folders of their own are still one album.
 *
 * A key is a hash, safe in an address ("phone:<key>"). Where an album's tags are in one folder only, its key is what it
 * was before folders counted (album artist and title alone), so what the phone already knows by it — a cover, a link —
 * stays; only an album its folders now part has keys of its own, one a folder.
 */
object PhoneAlbumKeys {
    /** One track: its album artist (or artist), its album title, the folder it is in (a document id or path). */
    data class Entry(val artist: String, val album: String, val folder: String)

    // Scanner.cs's disc folder (ScanNames.DiscDir): "CD1", "Disc 2", "Side 1", a whole word.
    private val DISC = Regex("^(cd|disc|disk|side)\\s*[-_.]?\\s*([0-9]+)\\b", RegexOption.IGNORE_CASE)

    /** The folder [folder]'s album is: its parent where it is a disc folder (CD1, Disc 2), else itself. */
    fun albumFolder(folder: String): String {
        val cut = maxOf(folder.lastIndexOf('/'), folder.lastIndexOf(':'))
        val name = folder.substring(cut + 1).trim()
        return if (cut > 0 && DISC.containsMatchIn(name)) folder.substring(0, cut) else folder
    }

    /** A short hash of [parts], safe in an address. */
    fun hash(vararg parts: String): String {
        val d = MessageDigest.getInstance("SHA-1").digest(parts.joinToString("|").toByteArray())
        return d.joinToString("") { "%02x".format(it) }.substring(0, 16)
    }

    /** Each entry's album key, in the order given. */
    fun keys(entries: List<Entry>): List<String> {
        val base = entries.map { hash(it.artist.lowercase().trim(), it.album.lowercase().trim()) }
        val folders = HashMap<String, MutableSet<String>>()
        entries.forEachIndexed { i, e -> folders.getOrPut(base[i]) { HashSet() } += albumFolder(e.folder) }
        return entries.mapIndexed { i, e ->
            if (folders[base[i]]!!.size <= 1) base[i]
            else hash(e.artist.lowercase().trim(), e.album.lowercase().trim(), albumFolder(e.folder))
        }
    }
}
