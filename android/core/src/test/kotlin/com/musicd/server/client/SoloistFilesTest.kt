package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files

class SoloistFilesTest {
    /** A tar as GNU tar writes one: a 512-byte header each, the data padded to 512, two empty blocks to end it. */
    private class Tar {
        val out = ByteArrayOutputStream()
        fun entry(name: String, data: ByteArray = ByteArray(0), type: Char = '0', mode: Int = 0b110_100_100) {
            if (name.length > 100) entry("././@LongLink", (name + "\u0000").toByteArray(), 'L')
            val h = ByteArray(512)
            name.take(100).toByteArray().copyInto(h, 0)
            "%07o\u0000".format(mode).toByteArray().copyInto(h, 100)
            "%011o\u0000".format(data.size).toByteArray().copyInto(h, 124)
            h[156] = type.code.toByte()
            "ustar  \u0000".toByteArray().copyInto(h, 257)
            out.write(h); out.write(data); out.write(ByteArray((512 - data.size % 512) % 512))
        }
        fun bytes(): ByteArray { out.write(ByteArray(1024)); return out.toByteArray() }
    }

    @Test fun `Spotify's archive unpacked, files and folders, the program runnable, a long name followed, links and escapes skipped`() {
        val to = Files.createTempDirectory("soloist").toFile()
        val program = ByteArray(300_000) { (it % 251).toByte() }
        val long = "n".repeat(150) + ".txt"
        val tar = Tar().apply {
            entry("./soloist-1.3.9/", type = '5', mode = 0b111_101_101)
            entry("./soloist-1.3.9/soloist", program, mode = 0b111_101_101)
            entry("./soloist-1.3.9/LICENSE", "licence\n".repeat(80).toByteArray())
            entry("./soloist-1.3.9/$long", "long".toByteArray())
            entry("./soloist-1.3.9/link", type = '2')
            entry("../evil", "no".toByteArray())
        }.bytes()
        val notes = mutableListOf<String>()
        SoloistFiles.untar(ByteArrayInputStream(tar), to) { notes += it }
        val bin = File(to, "soloist-1.3.9/soloist")
        assertTrue(program.contentEquals(bin.readBytes()))
        assertTrue("runnable, as its mode says", bin.canExecute())
        assertFalse("the licence isn't", File(to, "soloist-1.3.9/LICENSE").canExecute())
        assertEquals("long", File(to, "soloist-1.3.9/$long").readText())
        assertFalse(File(to, "soloist-1.3.9/link").exists())
        assertFalse("nothing outside the folder", File(to.parentFile, "evil").exists())
        assertEquals(listOf("file soloist-1.3.9/soloist (292 KB)", "file soloist-1.3.9/LICENSE (0 KB)", "file soloist-1.3.9/$long (0 KB)",
            "skipped soloist-1.3.9/link (type 2)"), notes)
    }

    @Test fun `each signed-in account asked for lossless once, its other prefs kept`() {
        val data = Files.createTempDirectory("soloist-data").toFile()
        val user = File(data, "settings/Users/abc-user").apply { mkdirs() }
        File(user, "prefs").writeText("ui.x=1\naudio.play_bitrate_enumeration=2\n")
        File(data, "settings/Users/not-a-user").mkdirs()
        assertTrue(SoloistFiles.askLossless(data))
        assertEquals(listOf("ui.x=1", "audio.play_bitrate_enumeration=5", "audio.play_bitrate_non_metered_enumeration=5", "audio.normalize_v2=false"),
            File(user, "prefs").readLines())
        assertFalse("already asked: nothing to start again for", SoloistFiles.askLossless(data))
        assertFalse("no accounts yet", SoloistFiles.askLossless(Files.createTempDirectory("empty").toFile()))
    }
}
