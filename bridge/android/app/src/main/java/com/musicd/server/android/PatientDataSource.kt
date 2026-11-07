package com.musicd.server.android

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Mandarin's continuous PCM (item 322) read with patience: a run is one stream for track after track, and Mandarin
 * waits, while the one being heard plays, to be told which track comes next before it sends any of it. A read that
 * waits so long is no fault there, where for a file it would be: the run is read from [patient] (its read timeout an
 * hour), every other address from [usual] (8 s). Which is which, by the address ([RawPcmExtractor.of]).
 */
@UnstableApi
class PatientDataSource(private val usual: DataSource, private val patient: DataSource) : DataSource {
    private var open: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        usual.addTransferListener(transferListener)
        patient.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val d = if (RawPcmExtractor.of(dataSpec.uri) != null) patient else usual
        open = d
        return d.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = open?.read(buffer, offset, length) ?: throw IllegalStateException("not open")

    override fun getUri(): Uri? = open?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = open?.responseHeaders ?: emptyMap()

    override fun close() { try { open?.close() } finally { open = null } }
}
