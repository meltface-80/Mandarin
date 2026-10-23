package com.musicd.server.android

import android.content.Context
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * The Soloist test build's files (bug list item 148, [SoloistPhone]): Soloist downloaded from Spotify for 64-bit ARM
 * and unpacked into the tree, as the server's SoloistDownload.cs does it; and each signed-in account's prefs asking for
 * lossless, as the server's Soloist.Prefs.cs writes them.
 */
object SoloistPhoneFiles {
    const val URL_ARM64 = "https://soloist-builds.spotifycdn.com/soloist_release_arm64.tar.gz"

    private fun into(c: Context) = File(SoloistPhone.root(c), "opt/soloist")

    /** The soloist program, once downloaded. */
    fun binary(c: Context): File? = into(c).walkTopDown().firstOrNull { it.isFile && it.name == "soloist" }

    /** Spotify's latest build for 64-bit ARM, unpacked into the tree (what was there before replaced). */
    fun download(c: Context, progress: (String) -> Unit) {
        val conn = (URL(URL_ARM64).openConnection() as HttpURLConnection).apply { connectTimeout = 15_000; readTimeout = 30_000 }
        val code = conn.responseCode
        if (code != 200) throw IllegalStateException("Spotify answered $code for $URL_ARM64")
        val total = conn.contentLengthLong
        SoloistPhone.note("download: $URL_ARM64 ($code, ${if (total > 0) "${total / 1024} KB" else "size not said"}; ${conn.getHeaderField("Last-Modified") ?: "no date"})")
        val fresh = File(SoloistPhone.dir(c), "opt-new")
        fresh.deleteRecursively()
        fresh.mkdirs()
        var got = 0L
        val counted = object : java.io.FilterInputStream(conn.inputStream) {
            private var shown = 0L
            override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, len).also {
                if (it > 0) { got += it; if (got - shown > 512 * 1024) { shown = got; progress("Downloading Soloist… ${got / 1024} KB") } }
            }
        }
        counted.use { untar(GZIPInputStream(it), fresh) }
        val dest = into(c)
        dest.deleteRecursively()
        dest.parentFile?.mkdirs()
        if (!fresh.renameTo(dest)) throw IllegalStateException("couldn't move Soloist into place")
        val bin = binary(c) ?: throw IllegalStateException("no soloist program in Spotify's archive")
        bin.setExecutable(true, false)
        SoloistPhone.note("download: ${got / 1024} KB; soloist is ${bin.length() / 1024} KB at ${SoloistPhone.soloist(c)}")
    }

    /** A tar stream's files and folders written under [to] (links and anything leaving [to] skipped). */
    private fun untar(input: InputStream, to: File) {
        val head = ByteArray(512)
        var longName: String? = null
        val base = to.canonicalPath + File.separator
        while (true) {
            if (!readFully(input, head)) break
            if (head.all { it.toInt() == 0 }) break
            val type = head[156].toInt().toChar()
            val size = octal(head, 124, 12)
            val mode = octal(head, 100, 8)
            val name = longName ?: run {
                val prefix = text(head, 345, 155)
                val n = text(head, 0, 100)
                if (prefix.isNotEmpty()) "$prefix/$n" else n
            }
            longName = null
            when (type) {
                'L' -> { longName = String(readBytes(input, size)).trimEnd('\u0000'); skipPad(input, size); continue }
                '0', '\u0000', '7' -> {
                    val f = File(to, name.removePrefix("./"))
                    if (!f.canonicalPath.startsWith(base)) { skip(input, size); skipPad(input, size); continue }
                    f.parentFile?.mkdirs()
                    f.outputStream().use { out -> copyN(input, out, size) }
                    if (mode and 0b001_000_000 != 0L) f.setExecutable(true, false)
                    SoloistPhone.note("download: file ${name.removePrefix("./")} (${size / 1024} KB)")
                }
                '5' -> File(to, name.removePrefix("./")).takeIf { it.canonicalPath.startsWith(base) }?.mkdirs()
                else -> { SoloistPhone.note("download: skipped ${name.removePrefix("./")} (type $type)"); skip(input, size) }
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
    private fun readBytes(i: InputStream, n: Long) = ByteArray(n.toInt()).also { readFully(i, it) }
    private fun copyN(i: InputStream, o: java.io.OutputStream, n: Long) {
        val buf = ByteArray(64 * 1024); var left = n
        while (left > 0) { val r = i.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (r < 0) throw java.io.EOFException("archive cut short"); o.write(buf, 0, r); left -= r }
    }
    private fun skip(i: InputStream, n: Long) { var left = n; while (left > 0) { val s = i.skip(left); if (s <= 0) { if (i.read() < 0) return; left-- } else left -= s } }
    private fun skipPad(i: InputStream, size: Long) { val pad = (512 - size % 512) % 512; skip(i, pad) }

    // ------------------------------------------------------------ lossless asked for

    private val LOSSLESS = listOf("audio.play_bitrate_enumeration" to "5", "audio.play_bitrate_non_metered_enumeration" to "5", "audio.normalize_v2" to "false")

    /** Every signed-in account's prefs asking for lossless, normalisation off; true when one changed (Soloist takes it up when started again). */
    fun askLossless(c: Context): Boolean {
        val users = File(SoloistPhone.data(c), "settings/Users")
        var changed = false
        for (d in users.listFiles().orEmpty().filter { it.isDirectory && it.name.endsWith("-user") }) {
            val f = File(d, "prefs")
            val lines = if (f.exists()) f.readLines() else emptyList()
            val had = lines.filter { l -> LOSSLESS.any { l.startsWith(it.first + "=") } }.toSet()
            if (had.size == LOSSLESS.size && LOSSLESS.all { "${it.first}=${it.second}" in had }) continue
            val kept = lines.filter { l -> LOSSLESS.none { l.startsWith(it.first + "=") } }
            File(d, "prefs.new").apply { writeText((kept + LOSSLESS.map { "${it.first}=${it.second}" }).joinToString("\n", postfix = "\n")) }.renameTo(f)
            changed = true
        }
        return changed
    }
}
