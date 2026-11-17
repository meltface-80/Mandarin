package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

/** The side menu's Export library (item 436): what the toast says, counted from the file the server writes. */
class ExportTest {
    private val csv = "album_artist,album,disc,track,title,artist,barcode,isrc,duration,year\r\n" +
        "Art Blakey,Moanin' (Blue Note Tone Poet),1,1,Moanin',Art Blakey,0602567000001,,575,1959\r\n" +
        "Art Blakey,Moanin' (Blue Note Tone Poet),1,2,Are You Real,Art Blakey,0602567000001,,288,1959\r\n" +
        "Art Blakey,Moanin' (Original),1,1,Moanin',Art Blakey,,,575,1959\r\n" +
        "\"Earth, Wind & Fire\",\"Live, at \"\"Last\"\"\",1,1,September,\"Earth, Wind & Fire\",5099749,USSM1,215,1978\r\n"

    @Test fun countsAlbumsTracksAndBarcodes() {
        // Three albums (a quoted comma and quotes kept in one), four tracks, two albums with a barcode.
        assertEquals(Export.Counts(3, 4, 2), Export.counts(csv))
    }

    @Test fun quotedCells() {
        assertEquals(listOf("Earth, Wind & Fire", "Live, at \"Last\""), Export.rows(csv)[4].take(2))
    }

    @Test fun nothingInIt() {
        assertEquals(Export.Counts(0, 0, 0), Export.counts(""))
        assertEquals(Export.Counts(0, 0, 0), Export.counts("album_artist,album,disc,track,title,artist,barcode,isrc,duration,year\r\n"))
    }

    @Test fun whatTheToastSays() {
        assertEquals("Exported 1,204 albums (980 with a barcode), 15,310 tracks: mandarin-library-2026-11-15.csv",
            Export.doneText(Export.Counts(1204, 15310, 980), Export.fileName(LocalDate.of(2026, 11, 15))))
        assertEquals("Exported 1 album (0 with a barcode), 1 track: x.csv", Export.doneText(Export.Counts(1, 1, 0), "x.csv"))
    }
}
