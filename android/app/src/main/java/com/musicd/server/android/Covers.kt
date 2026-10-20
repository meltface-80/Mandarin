package com.musicd.server.android

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.asImageBitmap
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The covers a wall's tiles show, kept once fetched (bug list item 51): the
 * last 48 MB of them by their address, so a wall scrolled back to, or come
 * back to from an album, draws at once; a tile asks for its own size, so a
 * three-across wall doesn't fetch 500px covers. Nothing is drawn here (the
 * screens contract's shell, docs/specs/screens.json).
 */
internal object Covers {
    private val cache = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = value.width * value.height * 4
    }

    fun get(url: String): ImageBitmap? = cache.get(url)
    fun put(url: String, image: ImageBitmap) { cache.put(url, image) }
}

/** The cover [key] at [size] pixels for a tile, kept or fetched and kept; null until then, or with no key. A "phone-" key is one of the phone's own albums (item 57), read from its index, never asked of the server. */
@Composable
internal fun rememberTileCover(key: String?, size: Int, client: () -> ServerClient?): ImageBitmap? {
    val context = LocalContext.current
    val phone = key != null && key.startsWith("phone-")
    val url = if (phone) key else key?.let { k -> client()?.imageUrl(k, size) }
    var image by remember(url) { mutableStateOf(url?.let { Covers.get(it) }) }
    LaunchedEffect(url) {
        if (url == null || image != null) return@LaunchedEffect
        val got = if (phone) withContext(Dispatchers.IO) { runCatching { LocalMusic.art(context, url.removePrefix("phone-"))?.let { BitmapFactory.decodeFile(it.path)?.asImageBitmap() } }.getOrNull() }
        else {
            val c = client() ?: return@LaunchedEffect
            withContext(Dispatchers.IO) { runCatching { c.bytes(url).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull() }
        }
        if (got != null) { Covers.put(url, got); image = got }
    }
    return image
}

/**
 * A picture at a web address of a service's or Pitchfork's own (the search's covers and artists' portraits, item 61), kept
 * as a tile's cover is; null until fetched, or with none. Asked without the server's token: the address isn't the server's.
 */
@Composable
internal fun rememberWebImage(url: String?): ImageBitmap? {
    var image by remember(url) { mutableStateOf(url?.let { Covers.get(it) }) }
    LaunchedEffect(url) {
        if (url == null || image != null || !(url.startsWith("https://") || url.startsWith("http://"))) return@LaunchedEffect
        val got = withContext(Dispatchers.IO) {
            runCatching {
                val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 5000; c.readTimeout = 15000
                try { if (c.responseCode == 200) c.inputStream.use { BitmapFactory.decodeStream(it)?.asImageBitmap() } else null } finally { c.disconnect() }
            }.getOrNull()
        }
        if (got != null) { Covers.put(url, got); image = got }
    }
    return image
}
