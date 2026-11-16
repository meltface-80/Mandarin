package com.musicd.server.client

/**
 * Whether an album may be kept on the phone, by where it is from (item 448): the library's own files, and iBroadcast's,
 * which are the owner's own files, uploaded; never Qobuz's or Tidal's, which aren't (album-editor-match.js
 * downloadMenuItem, the same).
 */
object Keepable {
    /** An album from [source] (null or "local": the library's own files). */
    fun album(source: String?): Boolean = source == null || source == "local" || source == "ibroadcast"
}
