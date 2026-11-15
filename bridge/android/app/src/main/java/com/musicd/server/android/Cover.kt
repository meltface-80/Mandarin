package com.musicd.server.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * A track's cover for Now Playing (item 430): fetched from the address Mandarin said of the track (X-Mandarin-Art, its
 * signed address, as a renderer fetches it: no sign-in), once a track, only while the screen is shown, and decoded no
 * larger than the screen needs. Null where there is none or it can't be had: the screen draws a plain square instead.
 */
object Cover {
    private const val MOST = 8 shl 20   // bytes: a cover is never this big; anything bigger isn't one
    private const val SIDE = 1024        // pixels: the largest side kept

    /** The cover at [url] (http or https), or null. Blocking: run off the main thread. */
    fun fetch(url: String): Bitmap? {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null
        return runCatching {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 5_000; c.readTimeout = 8_000; c.instanceFollowRedirects = false
            try {
                if (c.responseCode != 200) return null
                val bytes = c.inputStream.use { inp ->
                    val out = ByteArrayOutputStream(); val buf = ByteArray(16 * 1024)
                    while (true) { val n = inp.read(buf); if (n < 0) break; out.write(buf, 0, n); if (out.size() > MOST) return null }
                    out.toByteArray()
                }
                decode(bytes)
            } finally { c.disconnect() }
        }.getOrNull()
    }

    private fun decode(b: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(b, 0, b.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIDE) sample *= 2
        return BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
