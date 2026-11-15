package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * Edit album's Folders and copies and Library clean-up's albums that look like two copies merged (bug list item 424),
 * as the page's album-editor-split.js and settings-scanner-merged.js read and say them: /api/album/edit's "split" (the
 * folders an album's tracks are in where they are in more than one, the ways Split… lays them out in parts, whether it
 * is a part of a split), what Split, Join back and Look at this album again say once done, and /api/library/merged.
 */

/** A folder an album's tracks are in, and how many. */
data class SplitFolder(val folder: String, val tracks: Int)

/** A part a way of splitting makes: its name ("SACD Version", "24/192 FLAC", "Copy 1") and its tracks. */
data class SplitPart(val name: String, val tracks: Int)

/** A way to split ([by] "words", "format" or "numbers"), what it is called, and its parts, the biggest first. */
data class SplitWay(val by: String, val name: String, val parts: List<SplitPart>) {
    /** Its row: "By the version words in the titles: SACD Version (7) · Remastered 2013 (6)". */
    val line: String get() = name + ": " + parts.joinToString(" · ") { it.name + " (" + it.tracks + ")" }
}

/** What the editor shows of an album's folders and copies. */
data class AlbumSplit(val folders: List<SplitFolder>, val ways: List<SplitWay>, val part: Boolean) {
    /** Split by folder is offered: its tracks are in more than one folder. */
    val byFolder: Boolean get() = folders.size >= 2
    /** "Its tracks are in 2 folders: Moanin' (1959) (SACD Version) (7) · …"; null where they are in one. */
    val foldersLine: String? get() = if (folders.size < 2) null
        else "Its tracks are in " + folders.size + " folders: " + folders.joinToString(" · ") { it.folder + " (" + it.tracks + ")" }
}

/** An album on Library clean-up's list: why it looks like two copies merged. */
data class MergedAlbum(val offset: Long, val title: String, val artist: String, val tracks: Int, val folders: Int, val repeats: Boolean) {
    /** "Art Blakey — Moanin'". */
    val name: String get() = (if (artist.isNotEmpty()) "$artist — " else "") + title
    /** "2 folders · a track number twice on a disc · 13 tracks". */
    val why: String get() = listOfNotNull(if (folders > 1) "$folders folders" else null, if (repeats) "a track number twice on a disc" else null, "$tracks tracks").joinToString(" · ")
}

/** Library clean-up's list: how many there are, and the first 500. */
data class Merged(val count: Int, val albums: List<MergedAlbum>)

object AlbumSplitEdit {
    const val HEADING = "Folders and copies"
    const val NOTE = "Two releases in one album? Split them into albums of their own, versions of each other. Nothing on your drive is moved."
    const val MERGED_TITLE = "Look like two copies merged"
    const val MERGED_NOTE = "Two releases in one album: their tracks in two folders, or a track number twice on one disc. Split… opens the album's Edit album to split it; nothing on your drive is moved."

    /** The editor's view's "split": none from a server before item 424, or for a streamed album. */
    fun parse(j: JSONObject?): AlbumSplit? {
        if (j == null) return null
        val folders = objs(j.optJSONArray("folders")).map { SplitFolder(it.optString("folder"), it.optInt("tracks")) }
        val ways = objs(j.optJSONArray("ways")).map { w ->
            SplitWay(w.optString("by"), w.optString("name"), objs(w.optJSONArray("parts")).map { SplitPart(it.optString("name"), it.optInt("tracks")) })
        }
        return AlbumSplit(folders, ways, j.optBoolean("part"))
    }

    /** The albums an answer says its tracks are in now, the one kept first. */
    fun albums(j: JSONObject): List<Long> { val a = j.optJSONArray("albums") ?: JSONArray(); return (0 until a.length()).map { a.optLong(it) } }

    /** What is said once done: [action] "split", "join" or "look-again", [albums] how many its tracks are in now. */
    fun said(action: String, albums: Int): String = when (action) {
        "split" -> "Split into $albums albums — each a version of the others. Join back puts them together again."
        "join" -> "Joined back into one album."
        else -> if (albums > 1) "Looked at again: its tracks are in $albums albums now." else "Looked at again: nothing to change."
    }

    /** Its toast. */
    fun toast(action: String): String = when (action) { "split" -> "Album split"; "join" -> "Joined back"; else -> "Album looked at again" }

    /** Library clean-up's line: "3 albums look like two copies merged"; null where there are none. */
    fun mergedLine(n: Int): String? = if (n <= 0) null else Scanner.num(n.toLong()) + (if (n == 1) " album looks" else " albums look") + " like two copies merged"

    /** The list open's title, with its count. */
    fun mergedTitle(n: Int): String = MERGED_TITLE + " (" + Scanner.num(n.toLong()) + ")"

    /** GET /api/library/merged. */
    fun merged(j: JSONObject?): Merged = Merged(j?.optInt("count") ?: 0, objs(j?.optJSONArray("albums")).map {
        MergedAlbum(it.optLong("offset"), it.optString("title"), it.optString("artist"), it.optInt("tracks"), it.optInt("folders"), it.optBoolean("repeats"))
    })

    private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
}
