package com.musicd.server.client

import java.time.LocalDate

/**
 * The side menu's Export library (item 436): the library's own files as the server writes them for Mandarin Migration
 * (GET /api/export/library.csv, ExportRoutes.cs), saved where the phone's owner chooses. What the toast says of it is
 * counted from the file itself, as the page's says it from the server's X-Mandarin-Export (app/menu-export.js).
 */
object Export {
    const val PATH = "/api/export/library.csv"
    const val EXPORTING = "Exporting your library…"
    const val FAILED = "Export failed: the server couldn't be reached"
    const val NOT_WRITTEN = "Export failed: the file couldn't be saved there"

    /** How many albums, tracks and albums with a barcode a file holds. */
    data class Counts(val albums: Int, val tracks: Int, val barcodes: Int)

    /** The name the server gives the file, for the save dialog: mandarin-library-2026-11-15.csv. */
    fun fileName(day: LocalDate): String = "mandarin-library-$day.csv"

    /** What the toast says of an export saved as [name] (the page's words, app/menu-export.js). */
    fun doneText(c: Counts, name: String): String =
        String.format(java.util.Locale.ROOT, "Exported %,d %s (%,d with a barcode), %,d %s: %s", c.albums, if (c.albums == 1) "album" else "albums",
            c.barcodes, c.tracks, if (c.tracks == 1) "track" else "tracks", name)

    /** The albums (by album artist and album), tracks and albums with a barcode in [csv], as the server writes it. */
    fun counts(csv: String): Counts {
        val rows = rows(csv)
        if (rows.isEmpty()) return Counts(0, 0, 0)
        val head = rows[0]
        val artist = head.indexOf("album_artist"); val album = head.indexOf("album"); val barcode = head.indexOf("barcode")
        val albums = LinkedHashMap<String, Boolean>()
        var tracks = 0
        for (r in rows.drop(1)) {
            if (r.all { it.isEmpty() }) continue
            tracks++
            val key = r.getOrElse(artist) { "" } + "\u0000" + r.getOrElse(album) { "" }
            albums[key] = (albums[key] ?: false) || r.getOrElse(barcode) { "" }.isNotEmpty()
        }
        return Counts(albums.size, tracks, albums.values.count { it })
    }

    /** RFC 4180: rows of cells, a cell quoted where it holds a comma, a quote (doubled) or a line break. */
    fun rows(csv: String): List<List<String>> {
        val out = ArrayList<List<String>>()
        var row = ArrayList<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        while (i < csv.length) {
            val ch = csv[i]
            when {
                quoted && ch == '"' && i + 1 < csv.length && csv[i + 1] == '"' -> { cell.append('"'); i++ }
                quoted && ch == '"' -> quoted = false
                quoted -> cell.append(ch)
                ch == '"' -> quoted = true
                ch == ',' -> { row.add(cell.toString()); cell.setLength(0) }
                ch == '\r' -> {}
                ch == '\n' -> { row.add(cell.toString()); cell.setLength(0); out.add(row); row = ArrayList() }
                else -> cell.append(ch)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row.add(cell.toString()); out.add(row) }
        return out
    }
}
