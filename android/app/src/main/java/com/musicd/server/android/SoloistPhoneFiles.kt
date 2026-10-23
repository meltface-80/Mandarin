package com.musicd.server.android

import android.content.Context
import com.musicd.server.client.SoloistFiles
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * Soloist on the phone (bug list item 148, [SoloistPhone]): Soloist downloaded from Spotify for 64-bit ARM and
 * unpacked into the tree (core SoloistFiles), as the server's SoloistDownload.cs does it.
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
        counted.use { SoloistFiles.untar(GZIPInputStream(it), fresh) { SoloistPhone.note("download: $it") } }
        val dest = into(c)
        dest.deleteRecursively()
        dest.parentFile?.mkdirs()
        if (!fresh.renameTo(dest)) throw IllegalStateException("couldn't move Soloist into place")
        val bin = binary(c) ?: throw IllegalStateException("no soloist program in Spotify's archive")
        bin.setExecutable(true, false)
        SoloistPhone.note("download: ${got / 1024} KB; soloist is ${bin.length() / 1024} KB at ${SoloistPhone.soloist(c)}")
    }
}
