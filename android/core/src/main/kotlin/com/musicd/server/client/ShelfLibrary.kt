package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

/*
 * The Shelf's library natively (bug list item 207): /api/shelf/albums as the page's shelf-pick.js reads it — the whole
 * library once, each album with the places of its genres and its label, its letter, year, catalogue number, kinds,
 * format and version — and the orders the shelf is filed in (shelf-pick.js, shelforder.js): by artist as the server
 * sends it, by album, by label and catalogue number, by catalogue number alone, by year, or shuffled.
 */

/** A genre or a label as the shelf lists it: its name and how many albums carry it. */
data class ShelfName(val name: String, val count: Int)

/** A kind of release as the server names it: its id ("ep"), one ("EP") and many ("EPs"). */
data class ShelfKind(val id: String, val one: String, val many: String)

/**
 * An album on the Shelf (the answer's o, t, a, k, g, b, y, l, c, ty, fm, v): its id, title and artist, its cover's key,
 * the places of its genres in [ShelfLibrary.genres], the letter its artist is filed under, its year, the place of its
 * label in [ShelfLibrary.labels], its catalogue number, its kinds, its format ("FLAC 16/44.1") and its title split
 * from its version ("Discovery", "Deluxe Edition").
 */
data class ShelfCase(
    val offset: Long, val title: String, val artist: String, val imageKey: String?, val genres: List<Int>, val bucket: String,
    val year: Int?, val label: Int?, val catno: String?, val kinds: List<String>, val format: String?, val version: Pair<String, String>?,
) {
    /** The title as a spine and a card read it, its version apart. */
    val baseTitle: String get() = version?.first ?: title

    /** The version the title ends with, or "". */
    val versionText: String get() = version?.second.orEmpty()
}

/** The shelf as the server sent it: genres and labels commonest first, the kinds it names, the albums in artist order, and the signature to ask again with. */
data class ShelfLibrary(val genres: List<ShelfName>, val labels: List<ShelfName>, val kinds: List<ShelfKind>, val albums: List<ShelfCase>, val sig: String?) {
    /** The label's name of [a], or "" for none. */
    fun labelName(a: ShelfCase): String = a.label?.let { labels.getOrNull(it)?.name }.orEmpty()

    companion object {
        /** Where it is asked for: with the signature held, the answer is "the same" while nothing on the shelf changed. */
        fun path(sig: String?): String = "/api/shelf/albums" + if (sig.isNullOrEmpty()) "" else "?sig=" + java.net.URLEncoder.encode(sig, "UTF-8")

        /** The answer read; null when it says the shelf held is still the same. */
        fun parse(j: JSONObject): ShelfLibrary? {
            if (j.optBoolean("same", false)) return null
            return ShelfLibrary(names(j.optJSONArray("genres")), names(j.optJSONArray("labels")),
                objects(j.optJSONArray("kinds")).map { ShelfKind(it.optString("id"), it.optString("one"), it.optString("many")) },
                objects(j.optJSONArray("albums")).map(::case), j.str("sig"))
        }

        private fun case(o: JSONObject) = ShelfCase(
            offset = o.optLong("o"), title = o.optString("t"), artist = o.optString("a"), imageKey = o.str("k"),
            genres = ints(o.optJSONArray("g")), bucket = o.str("b") ?: "#", year = o.int("y"), label = o.int("l"), catno = o.str("c"),
            kinds = o.optJSONArray("ty")?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() } }.orEmpty(),
            format = o.str("fm"),
            version = o.optJSONArray("v")?.takeIf { it.length() == 2 }?.let { it.optString(0) to it.optString(1) }
        )

        private fun names(a: JSONArray?) = objects(a).map { ShelfName(it.optString("name"), it.optInt("count")) }
        private fun objects(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
        private fun ints(a: JSONArray?): List<Int> = if (a == null) emptyList() else (0 until a.length()).map { a.optInt(it) }
        // A JSON null asked whether it is one first: Android's org.json answers optString of it with "null" (AlbumExtras).
        private fun JSONObject.str(k: String): String? = if (!has(k) || isNull(k)) null else optString(k, "").ifEmpty { null }
        private fun JSONObject.int(k: String): Int? = if (!has(k) || isNull(k)) null else optInt(k)
    }
}

/** The orders the shelf is filed in, and the names they are compared by (shelf-pick.js, shelforder.js). */
object ShelfSort {
    /** The orders, each with its name and its line on the Order tab, the artist order first (the default). */
    val ORDERS = listOf(
        Triple("artist", "A → Z by artist", "As a shop files them: by the artist's name, then the title."),
        Triple("album", "A → Z by album", "By the album's title, a leading The, A or An not counting; two of one name in the artist's order."),
        Triple("label", "By label and catalogue №", "Each label together, its releases in catalogue order. Albums with no label come last, by artist."),
        Triple("catno", "By catalogue №", "The numbers in order across every label, as a shop's stock list. Albums with no number come last, by artist."),
        Triple("year", "By year", "Oldest first. Albums with no year come last."),
        Triple("random", "Random order", "The shelf in a random order, as on the Random albums screen. Only the genres, artists, decades, labels and types you have chosen, if any."),
    )

    /** An order's name ("A → Z by artist"). */
    fun name(id: String): String = ORDERS.firstOrNull { it.first == id }?.second ?: id

    private val primary: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.PRIMARY }
    private val variant: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.TERTIARY }

    /**
     * Two names in a shop's order, as the page's Intl.Collator("en", numeric, base) has them: numbers as numbers ("WARP 61"
     * before "WARP 123", "Label 9" before "Label 10"), case and accents alike.
     */
    fun natural(a: String, b: String): Int {
        val x = runs(a); val y = runs(b)
        for (i in 0 until minOf(x.size, y.size)) {
            val p = x[i]; val q = y[i]
            val dp = p[0] in '0'..'9'; val dq = q[0] in '0'..'9'
            val c = when {
                dp && dq -> BigInteger(p).compareTo(BigInteger(q))
                dp -> -1   // a number before a word, as the collator puts digits before letters
                dq -> 1
                else -> primary.compare(p, q)
            }
            if (c != 0) return c
        }
        return x.size.compareTo(y.size)
    }

    private fun runs(s: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < s.length) {
            val d = s[i] in '0'..'9'
            var j = i
            while (j < s.length && (s[j] in '0'..'9') == d) j++
            out += s.substring(i, j)
            i = j
        }
        return out
    }

    /** A name folded as the server folds it (Names.Fold, shelforder.js fold): accents and case gone, "&" as "and", anything else a space. */
    fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKD).filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() }.lowercase(Locale.ROOT)
        .replace("&", " and ").replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()

    /** The name a title is filed under (Names.SortName): "The Wall" and "Wall, The" under "wall". */
    fun titleKey(title: String): String {
        val t = title.trim()
        val last = Regex("^(.*),\\s*(the|a|an)$", RegexOption.IGNORE_CASE).find(t)
        return fold(last?.groupValues?.get(1) ?: t.replace(Regex("^(the|a|an)\\s+", RegexOption.IGNORE_CASE), ""))
    }

    /** The letter a folded name is filed under: A–Z, 1–9 or "#". */
    fun bucket(key: String): String {
        val c = key.firstOrNull() ?: return "#"
        return when (c) { in 'a'..'z' -> c.uppercaseChar().toString(); in '1'..'9' -> c.toString(); else -> "#" }
    }

    /** The albums by title, A → Z: two of one title in the order given (the artist order). */
    fun byAlbum(list: List<ShelfCase>): List<ShelfCase> =
        list.mapIndexed { i, a -> Triple(a, i, titleKey(a.title)) }.sortedWith { x, y -> variant.compare(x.third, y.third).takeIf { it != 0 } ?: x.second.compareTo(y.second) }.map { it.first }

    /** [list] filed in the order [by] ([seed] the shuffle's), from the artist order the server sends; a stable sort keeps it within a label or a year. */
    fun filed(lib: ShelfLibrary, list: List<ShelfCase>, by: String, seed: Long): List<ShelfCase> = when (by) {
        "random" -> shuffled(list, seed)
        "album" -> byAlbum(list)
        "label" -> list.sortedWith { x, y ->
            if ((x.label == null) != (y.label == null)) (if (x.label == null) 1 else -1)
            else natural(lib.labelName(x), lib.labelName(y)).takeIf { it != 0 } ?: lastIfNone(x.catno, y.catno).takeIf { it != 0 } ?: natural(x.title, y.title)
        }
        "catno" -> list.sortedWith { x, y ->
            if ((x.catno == null) != (y.catno == null)) (if (x.catno == null) 1 else -1)
            else natural(x.catno.orEmpty(), y.catno.orEmpty()).takeIf { it != 0 } ?: natural(x.title, y.title)
        }
        "year" -> list.sortedWith { x, y -> if ((x.year == null) != (y.year == null)) (if (x.year == null) 1 else -1) else (x.year ?: 0).compareTo(y.year ?: 0) }
        else -> list
    }

    /** Two catalogue numbers in order, none after any (the page compares "\uffff" for none, which its collator puts after every letter). */
    private fun lastIfNone(x: String?, y: String?): Int = when {
        x == null && y == null -> 0
        x == null -> 1
        y == null -> -1
        else -> natural(x, y)
    }

    /** The page's shuffle (shelf.js rng, a xorshift from [seed]): the same seed, the same order. */
    fun shuffled(list: List<ShelfCase>, seed: Long): List<ShelfCase> {
        val out = list.toMutableList()
        val r = rng(seed)
        for (i in out.size - 1 downTo 1) { val j = (r() * (i + 1)).toInt(); val t = out[i]; out[i] = out[j]; out[j] = t }
        return out
    }

    /** shelf.js rng: xorshift32 from [seed], each draw in [0, 1). */
    fun rng(seed: Long): () -> Double {
        var s = (seed and 0xffffffffL).toInt().let { if (it == 0) 1 else it }
        return {
            s = s xor (s shl 13); s = s xor (s ushr 17); s = s xor (s shl 5)
            (s.toLong() and 0xffffffffL) / 4294967296.0
        }
    }

    /** shelf.js hash: FNV-1a over [s]'s UTF-16 units, as an unsigned 32-bit number. */
    fun hash(s: String): Long {
        var h = 2166136261L
        for (ch in s) { h = h xor ch.code.toLong(); h = (h * 16777619L) and 0xffffffffL }
        return h
    }
}
