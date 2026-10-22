package com.musicd.server.android

import androidx.compose.ui.graphics.ImageBitmap
import com.musicd.server.client.ArtistAbout
import com.musicd.server.client.ArtistAlbums
import com.musicd.server.client.ArtistBio
import com.musicd.server.client.ArtistSimilar
import com.musicd.server.client.SimilarAlbum
import com.musicd.server.client.TimedCache

/** What an artist's page had when last open (bug list item 140): drawn at once as it was when opened again, picture and all. */
internal data class ArtistPage(val albums: ArtistAlbums? = null, val about: ArtistAbout? = null, val bio: ArtistBio? = null, val similar: ArtistSimilar? = null,
                               val similarAlbums: List<SimilarAlbum>? = null, val portrait: ImageBitmap? = null)

/** The last two dozen artists' pages, asked for afresh after fifteen minutes (until then, not asked for at all). */
internal object ArtistPages {
    val kept = TimedCache<String, ArtistPage>(capacity = 24, ttlMs = 15 * 60_000L)
    fun key(name: String) = name.trim().lowercase()
}
