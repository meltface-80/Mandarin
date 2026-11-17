package com.musicd.server.client

/**
 * Whether an album is the owner's own, by where it is from: the library's files, and iBroadcast's, the owner's own files
 * uploaded; never Qobuz's or Tidal's, which aren't (album-editor-match.js ownAlbum, the same). Its own, it may be kept on
 * the phone (item 448) and edited (item 458), its edits Mandarin's alone.
 */
object OwnAlbum {
    /** An album from [source] (null or "local": the library's own files). */
    fun mine(source: String?): Boolean = source == null || source == "local" || source == "ibroadcast"
}
