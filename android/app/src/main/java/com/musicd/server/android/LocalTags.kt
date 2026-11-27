package com.musicd.server.android

import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.MediaMetadataRetriever.METADATA_KEY_DATE
import android.media.MediaMetadataRetriever.METADATA_KEY_YEAR
import android.net.Uri
import android.os.Build
import com.musicd.server.client.TagDate

/**
 * One music file's tags, as LocalMusic keeps them in its index: title, artist, disc and track, length, rate and depth,
 * the album's tags, and its release date — the whole day where the tags give one (a Qobuz FLAC's DATE, core's
 * [TagDate], item 541), so the phone's own albums are dated with the server off.
 */
internal object LocalTags {
    fun read(c: Context, uri: Uri, name: String, ext: String, size: Long, mtime: Long): LocalMusic.Track {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(c, uri)
            val get = { k: Int -> r.extractMetadata(k)?.trim()?.takeIf { it.isNotEmpty() } }
            val num = { s: String? -> s?.substringBefore('/')?.trim()?.toIntOrNull() ?: 0 }
            val title = get(MediaMetadataRetriever.METADATA_KEY_TITLE) ?: name.substringBeforeLast('.')
            val artist = get(MediaMetadataRetriever.METADATA_KEY_ARTIST) ?: get(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST) ?: ""
            val duration = (get(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0
            val rate = if (Build.VERSION.SDK_INT >= 31) get(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull() ?: 0 else 0
            val bits = if (Build.VERSION.SDK_INT >= 31) get(MediaMetadataRetriever.METADATA_KEY_BITS_PER_SAMPLE)?.toIntOrNull() ?: 0 else 0
            val year = (get(METADATA_KEY_YEAR) ?: get(METADATA_KEY_DATE))?.let { Regex("\\d{4}").find(it)?.value?.toIntOrNull() }
            return LocalMusic.Track(uri.toString(), name, title, artist, num(get(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)).coerceAtLeast(1),
                num(get(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)), duration, ext, size, mtime, rate, bits,
                get(MediaMetadataRetriever.METADATA_KEY_ALBUM) ?: "", get(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST) ?: "", year, true,
                date = TagDate.of(get(METADATA_KEY_YEAR), get(METADATA_KEY_DATE)))
        } catch (e: Exception) {
            return LocalMusic.Track(uri.toString(), name, name.substringBeforeLast('.'), "", 1, 0, 0.0, ext, size, mtime, 0, 0, "", "", null, true, failed = true)
        } finally { runCatching { r.release() } }
    }
}
