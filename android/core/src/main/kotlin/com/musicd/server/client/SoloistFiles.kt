package com.musicd.server.client

import java.io.File
import java.io.InputStream
import java.io.OutputStream

/**
 * Soloist on the phone (bug list item 148): the files the app handles for it, with no Android in them. Spotify's
 * archive unpacked ([untar]), and each signed-in account's prefs asking for lossless ([askLossless]), as the server's
 * Soloist.Prefs.cs writes them.
 */
object SoloistFiles {
    /**
     * A tar stream's files and folders written under [to], each file [note]d; links, and anything that would land
     * outside [to], skipped. GNU long names are followed.
     */
    fun untar(input: InputStream, to: File, note: (String) -> Unit) {
        val head = ByteArray(512)
        var longName: String? = null
        val base = to.canonicalPath + File.separator
        while (true) {
            if (!readFully(input, head) || head.all { it.toInt() == 0 }) break
            val type = head[156].toInt().toChar()
            val size = octal(head, 124, 12)
            val mode = octal(head, 100, 8)
            val name = (longName ?: run {
                val prefix = text(head, 345, 155)
                val n = text(head, 0, 100)
                if (prefix.isNotEmpty()) "$prefix/$n" else n
            }).removePrefix("./")
            longName = null
            val f = File(to, name)
            val inside = f.canonicalPath.startsWith(base)
            when (type) {
                'L' -> { longName = String(ByteArray(size.toInt()).also { readFully(input, it) }).trimEnd('\u0000'); skipPad(input, size); continue }
                '0', '\u0000', '7' -> if (inside) {
                    f.parentFile?.mkdirs()
                    f.outputStream().use { copyN(input, it, size) }
                    if (mode and 0b001_000_000 != 0L) f.setExecutable(true, false)
                    note("file $name (${size / 1024} KB)")
                } else skip(input, size)
                '5' -> if (inside) f.mkdirs()
                else -> { note("skipped $name (type $type)"); skip(input, size) }
            }
            skipPad(input, size)
        }
    }

    private fun text(b: ByteArray, at: Int, n: Int): String {
        var end = at
        while (end < at + n && b[end].toInt() != 0) end++
        return String(b, at, end - at, Charsets.UTF_8)
    }
    private fun octal(b: ByteArray, at: Int, n: Int) = text(b, at, n).trim().ifEmpty { "0" }.toLong(8)
    private fun readFully(i: InputStream, b: ByteArray): Boolean {
        var n = 0
        while (n < b.size) { val r = i.read(b, n, b.size - n); if (r < 0) return false; n += r }
        return true
    }
    private fun copyN(i: InputStream, o: OutputStream, n: Long) {
        val buf = ByteArray(64 * 1024)
        var left = n
        while (left > 0) {
            val r = i.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (r < 0) throw java.io.EOFException("archive cut short")
            o.write(buf, 0, r); left -= r
        }
    }
    private fun skip(i: InputStream, n: Long) {
        var left = n
        while (left > 0) { val s = i.skip(left); if (s <= 0) { if (i.read() < 0) return; left-- } else left -= s }
    }
    private fun skipPad(i: InputStream, size: Long) = skip(i, (512 - size % 512) % 512)

    /** Spotify's numbers for lossless at either kind of network, and loudness normalisation off. */
    val LOSSLESS = listOf("audio.play_bitrate_enumeration" to "5", "audio.play_bitrate_non_metered_enumeration" to "5", "audio.normalize_v2" to "false")

    /**
     * Every signed-in account under Soloist's [data] folder asking for lossless (settings/Users/<id>-user/prefs, key=value
     * lines, the rest kept); true when one changed, as Soloist takes it up only when started again.
     */
    fun askLossless(data: File): Boolean {
        var changed = false
        for (d in File(data, "settings/Users").listFiles().orEmpty().filter { it.isDirectory && it.name.endsWith("-user") }) {
            val f = File(d, "prefs")
            val lines = if (f.exists()) f.readLines() else emptyList()
            val had = lines.filter { l -> LOSSLESS.any { l.startsWith(it.first + "=") } }.toSet()
            if (had.size == LOSSLESS.size && LOSSLESS.all { "${it.first}=${it.second}" in had }) continue
            val kept = lines.filter { l -> LOSSLESS.none { l.startsWith(it.first + "=") } }
            val fresh = File(d, "prefs.new")
            fresh.writeText((kept + LOSSLESS.map { "${it.first}=${it.second}" }).joinToString("\n", postfix = "\n"))
            fresh.renameTo(f)
            changed = true
        }
        return changed
    }
}
