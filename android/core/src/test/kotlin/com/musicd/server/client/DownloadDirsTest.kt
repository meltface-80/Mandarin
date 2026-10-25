package com.musicd.server.client

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** The downloaded albums' folders (bug list item 191). */
class DownloadDirsTest {
    private val root: File = Files.createTempDirectory("downloads").toFile()

    @After fun clean() { root.deleteRecursively() }

    private fun file(f: File, bytes: Int) { f.parentFile.mkdirs(); f.writeBytes(ByteArray(bytes)) }

    /** As DownloadStore.save writes it: the folder made if need be, album.json written. */
    private fun save(dir: File, state: String) { dir.mkdirs(); File(dir, "album.json").writeText("""{"id":${dir.name},"state":"$state"}""") }

    @Test fun an_album_removed_while_downloading_stays_removed() {
        val dir = File(root, "42")
        save(dir, "downloading")
        file(File(dir, "1.flac"), 10)
        file(File(dir, "2.flac.part"), 5)
        assertTrue(DownloadDirs.whileKept(dir) { save(dir, "downloading") })

        DownloadDirs.remove(dir)
        // The download, still running, finishes its track (or stops): its write doesn't bring the album back.
        assertFalse(DownloadDirs.whileKept(dir) { save(dir, "done") })
        assertFalse(File(dir, "album.json").exists())
        assertFalse(dir.exists())
    }

    @Test fun the_space_used_is_the_albums_own_files() {
        val phone = File(root, "phone")
        val folder = File(root, "Music")
        save(File(phone, "7"), "done")
        file(File(phone, "7/1.flac"), 1000)
        file(File(phone, "7/cover.jpg"), 100)
        save(File(phone, "8"), "downloading")
        file(File(phone, "8/1.flac"), 500)
        file(File(phone, "8/2.flac.part"), 300)          // still coming in
        file(File(phone, "9/1.flac"), 4000)              // a folder waiting to be deleted: its album.json gone
        file(File(folder, "Someone else/01.mp3"), 9000)  // the chosen folder's other music
        file(File(folder, "notes.txt"), 50)
        save(File(folder, "12"), "done")
        file(File(folder, "12/1.flac"), 2000)

        val json = { n: String -> File(root, n).length() }
        val expected = 1000 + 100 + 500 + 2000 + json("phone/7/album.json") + json("phone/8/album.json") + json("Music/12/album.json")
        assertEquals(expected, DownloadDirs.usedBytes(listOf(phone, folder)))
    }
}
