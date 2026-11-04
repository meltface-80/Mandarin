package com.musicd.server.android

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The header of a capture (Capture.kt): WAVE_FORMAT_EXTENSIBLE, as SQ-tool writes and reads its own, the container
 * the DAC's slot ([slotBytes] a channel) and [validBits] the bits of it in use, [dataBytes] of samples after it.
 */
object CaptureWav {
    const val SIZE = 68
    private val PCM_GUID_TAIL = byteArrayOf(0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80.toByte(), 0x00, 0x00, 0xAA.toByte(), 0x00, 0x38, 0x9B.toByte(), 0x71)

    fun header(rate: Int, channels: Int, slotBytes: Int, validBits: Int, dataBytes: Long): ByteArray {
        val b = ByteBuffer.allocate(SIZE).order(ByteOrder.LITTLE_ENDIAN)
        val block = channels * slotBytes
        b.put("RIFF".toByteArray()).putInt((SIZE - 8 + dataBytes).toInt()).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(40).putShort(0xFFFE.toShort()).putShort(channels.toShort()).putInt(rate)
            .putInt(rate * block).putShort(block.toShort()).putShort((slotBytes * 8).toShort()).putShort(22)
            .putShort(minOf(validBits, slotBytes * 8).toShort())
            .putInt(if (channels == 2) 0x3 else 0).putShort(1).put(PCM_GUID_TAIL)
        b.put("data".toByteArray()).putInt(dataBytes.toInt())
        return b.array()
    }
}
