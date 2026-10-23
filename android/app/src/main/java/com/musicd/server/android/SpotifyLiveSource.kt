package com.musicd.server.android

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.ResolvingDataSource
import com.musicd.server.client.CachePlan

/**
 * Spotify's live stream on the phone (bug list item 146; core [CachePlan.live]): it has no end and no length, so it
 * passes the phone's cache of tracks by. [PhonePlayerService] reads through the cache; this keeps the stream out of it.
 */
@OptIn(UnstableApi::class)
internal object SpotifyLiveSource {
    /** A cache key of its own each time it is opened, so nothing earlier is ever read back; null for anything else. */
    fun key(spec: DataSpec): String? = if (CachePlan.live(spec.uri.toString())) "live:" + System.nanoTime() else null

    /** [cached] with Spotify's stream never written into the cache (its length unknown, by the sink's own flag). */
    fun uncached(cached: DataSource.Factory): DataSource.Factory = ResolvingDataSource.Factory(cached) { spec ->
        if (CachePlan.live(spec.uri.toString())) spec.buildUpon().setFlags(spec.flags or DataSpec.FLAG_DONT_CACHE_IF_LENGTH_UNKNOWN).build() else spec
    }
}
