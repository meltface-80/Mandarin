package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * Edit album's Match by sound (bug list item 419), typed: the server's job (/api/identify/sound) — where it is, what came
 * of it, the releases the album's tracks are on by AcoustID — with what the page says of each, as album-editor-sound.js
 * says them; and the Album Scanner's tally of it under Settings → API Keys' AcoustID key, as settings.js's soundTallyText.
 */

/** A release the tracks are on by sound: its names, what sets it apart, how many of the tracks are on it, how sure the scan is and why. */
data class SoundRelease(val mbid: String, val artist: String, val title: String, val year: String, val releaseYear: String, val edition: String,
                        val country: String, val trackCount: Int, val missing: Int, val extra: Int, val heard: Int, val tracksHeard: Int,
                        val confidence: Int, val reasons: List<String>) {
    /** Its artist and title, as its row's first line. */
    val name: String get() = (if (artist.isNotEmpty()) "$artist — " else "") + title.ifEmpty { "—" }
    /** How sure, as the row's corner says it. */
    val sure: String get() = "$confidence % sure"
    /** Sure enough to be said in the accent. */
    val accent: Boolean get() = confidence >= 90
    /** Its second line: as Find match's (the year, this pressing's, the edition, the country, the tracks), and how many of the tracks are on it by sound. */
    val line: String get() = listOfNotNull(year.ifEmpty { null },
        "this pressing $releaseYear".takeIf { releaseYear.isNotEmpty() && year.isNotEmpty() && releaseYear != year },
        edition.ifEmpty { null }, country.ifEmpty { null }, "$trackCount tracks".takeIf { trackCount > 0 },
        "$missing missing here".takeIf { missing > 0 }, "$extra not on it".takeIf { extra > 0 },
        "$heard of $tracksHeard tracks by sound").joinToString(" · ")
    /** Why, past how it was found (the line above says it): "4 of 4 tracks' lengths agree · title and artist agree"; null when nothing more. */
    val why: String? get() = reasons.drop(1).joinToString(" · ").ifEmpty { null }
}

/**
 * The job for one album: [state] "fingerprinting", "asking", "fetching" or "done" (else "none": never asked; "busy":
 * another album's under way), [done] of [of] at its step, its [answer] once done ("needs-key", "refused", "limited",
 * "unreachable", "no-match", "no-files", "failed"; null with releases) and the [releases] found.
 */
data class SoundJob(val state: String, val done: Int, val of: Int, val answer: String?, val error: String?, val releases: List<SoundRelease>) {
    val working: Boolean get() = state in listOf("fingerprinting", "asking", "fetching")
    val finished: Boolean get() = state == "done"

    /** What it says, as the page's aeSoundSaid. */
    val said: Said get() {
        fun n(k: Int) = "$k " + if (k == 1) "track" else "tracks"
        return when (state) {
            "fingerprinting" -> Said(if (of > 0) "Fingerprinting ${minOf(done + 1, of)} of ${n(of)}…" else "Fingerprinting the tracks…", " On the server, a track at a time.")
            "asking" -> Said("Asking AcoustID…", " $done of ${n(of)} (three a second).")
            "fetching" -> Said("Asking MusicBrainz for the releases…", " A few seconds: one request a second.")
            else -> when (answer) {
                "needs-key" -> Said("No AcoustID key.", " Add an AcoustID key in Settings → API Keys.")
                "refused" -> Said("AcoustID refused the key.", " Check it in Settings → API Keys.")
                "limited" -> Said("AcoustID asks to wait.", " Try again in a few minutes.")
                "unreachable" -> Said("AcoustID can't be reached.", " Try again later.")
                "no-files" -> Said("No files to listen to.", " Only an album's own files can be matched by sound.")
                "failed" -> Said("Matching by sound didn't work", " (${error ?: "no answer"}).")
                else -> if (answer == null && releases.isNotEmpty()) Said("By sound:", " the releases these tracks are on. Tap the right one to apply.")
                    else Said("AcoustID doesn't know these recordings.", " Try Find match, or the barcode.")
            }
        }
    }

    companion object {
        /** What is said while it is being asked for, before the server's first answer. */
        val STARTING = SoundJob("fingerprinting", 0, 0, null, null, emptyList()).said

        fun failed(why: String) = SoundJob("done", 0, 0, "failed", why, emptyList())

        fun parse(j: JSONObject): SoundJob = SoundJob(j.optString("state").ifEmpty { "none" }, j.optInt("done"), j.optInt("of"),
            j.optString("answer").takeIf { !j.isNull("answer") && it.isNotEmpty() }, j.optString("error").takeIf { !j.isNull("error") && it.isNotEmpty() },
            objs(j.optJSONArray("releases")).map {
                SoundRelease(it.optString("mbid"), str(it, "artist"), str(it, "title"), str(it, "year"), str(it, "release_year"), str(it, "edition"),
                    str(it, "country"), it.optInt("track_count"), it.optInt("missing_tracks"), it.optInt("extra_tracks"), it.optInt("heard"),
                    it.optInt("tracks_heard"), it.optInt("confidence"),
                    it.optJSONArray("reasons")?.let { r -> (0 until r.length()).map { i -> r.optString(i) }.filter { s -> s.isNotEmpty() } }.orEmpty())
            })
    }
}

/** The Album Scanner's matching by sound (Settings → API Keys, under AcoustID's key): albums [matched] so far, [waiting] still to look at, and why not now ([held] "off" or "hours"). */
data class SoundTally(val matched: Int, val waiting: Int, val held: String?) {
    /** The line, as the page's soundTallyText. */
    val line: String get() {
        val whenSaid = if (waiting == 0) "" else when (held) { "off" -> ", when the Album Scanner is on"; "hours" -> ", in the Album Scanner's hours"; else -> "" }
        return "By sound: $matched " + (if (matched == 1) "album" else "albums") + " matched so far, $waiting still to look at$whenSaid."
    }

    companion object {
        fun parse(j: JSONObject?): SoundTally? = j?.let { SoundTally(it.optInt("matched"), it.optInt("waiting"), it.optString("held").takeIf { h -> !it.isNull("held") && h.isNotEmpty() }) }
    }
}

/** A field's words: a number as the page writes it (1999, not 1999.0); "" when it is missing or null. */
private fun str(j: JSONObject, key: String): String {
    if (!j.has(key) || j.isNull(key)) return ""
    val v = j.opt(key)
    return if (v is Number && v.toDouble() == Math.floor(v.toDouble())) v.toLong().toString() else v.toString()
}

private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
