package com.musicd.server.client

import org.json.JSONObject

/*
 * Edit album's Version (bug list item 420), as the page's album-editor-version.js reads and says it: the copy's version
 * name, label, catalogue number, barcode, country, this pressing's year and format, each as the match applied gives it,
 * else the files, else yours (/api/album/edit's "version"); what is said under a field that differs from theirs, the
 * words Save sends, and the fields a release applied from the editor fills (every one not typed in since it opened).
 */

/** A version's field as the editor shows it: its words now, what Put back gives it ([was], from the "match" or the "files", or none), and whether it is [edited] (yours). */
data class VersionField(val value: String, val was: String, val from: String?, val edited: Boolean)

object AlbumVersionEdit {
    /** The fields, in the editor's order (each one's contract key is "album-edit.version-" and it). */
    val FIELDS = listOf("name", "label", "catno", "barcode", "country", "year", "format")
    const val HEADING = "Version"
    const val NOTE = "What this copy is, from the match or its files. Change what's wrong: what you write stays when another match or edition is applied."
    /** Each field's placeholder, as the page's. */
    val PLACEHOLDER = mapOf("name" to "Mono, 2008 release, HDTT DSD256…", "country" to "US, GB, JP…", "format" to "CD, SACD, Vinyl…")

    /** The editor's view's "version": none from a server before it. */
    fun parse(j: JSONObject?): Map<String, VersionField> {
        if (j == null) return emptyMap()
        return FIELDS.mapNotNull { f ->
            j.optJSONObject(f)?.let { o -> f to VersionField(str(o, "value"), str(o, "was"), str(o, "from").ifEmpty { null }, o.optBoolean("edited")) }
        }.toMap()
    }

    /** Under a field whose words ([now]) differ from the match's or the files' ([f]; [matched]: a match is applied): what they say, before Put back; null when they agree. */
    fun was(f: VersionField?, now: String, matched: Boolean): String? {
        val was = f?.was.orEmpty()
        if (now.trim() == was) return null
        val from = f?.from ?: if (matched) "match" else "files"
        return "From the " + (if (from == "match") "match" else "files") + ": " + was.ifEmpty { "(none)" } + " · "
    }

    /** Why this pressing's year can't be saved (null: it can): four digits or none. */
    fun yearError(year: String): String? = if (year.trim().isEmpty() || Regex("^\\d{4}$").matches(year.trim())) null
        else "This pressing's year should be four digits, like 2008."

    /** The words in the fields once a release is applied: the new view's ([fields]), save in those typed in since the editor opened ([typed]). */
    fun refill(now: Map<String, String>, typed: Set<String>, fields: Map<String, VersionField>): Map<String, String> =
        FIELDS.associateWith { f -> if (f in typed) now[f].orEmpty() else fields[f]?.value.orEmpty() }

    /** Save's "version": each field as typed. */
    fun body(values: Map<String, String>): JSONObject = JSONObject().also { o -> FIELDS.forEach { o.put(it, values[it].orEmpty().trim()) } }

    private fun str(o: JSONObject, k: String): String = if (!o.has(k) || o.isNull(k)) "" else o.opt(k).let { v ->
        if (v is Number && v.toDouble() == Math.floor(v.toDouble())) v.toLong().toString() else v.toString()
    }
}
