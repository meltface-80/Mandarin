package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MQA's words in the app (bug list item 418), as the page says them (public/app/mqa.js): the badge on an album's
 * tracks and in Now playing ("MQA · 24/352.8 original", "MQA Studio · 24/192 original"), the Versions tab's rate line
 * with it, Now playing's "MQA: sent untouched to the DAC" where the room does, and Audio Devices' This DAC decodes MQA.
 */
class MqaTest {
    @Test
    fun the_badge_says_MQA_or_MQA_Studio_with_the_original_rate() {
        assertEquals("MQA · 24/352.8 original", Mqa(false, 352800, 24).label)
        assertEquals("MQA Studio · 24/192 original", Mqa(true, 192000, 24).label)
        assertEquals("MQA · 16/44.1 original", Mqa(false, 44100, 16).label)
        assertEquals("MQA Studio", Mqa(true, 0, 24).label)
        assertEquals("MQA · 88.2 original", Mqa(false, 88200, 0).label)
    }

    @Test
    fun the_server_answers_are_read_a_track_an_album_and_now_playing() {
        val track = Track.parse(JSONObject("""{"track_id": 3, "title": "Song", "subtitle": "4:05", "length": 245, "quality": "24/44.1", "mqa": {"studio": true, "original_rate": 352800, "bits": 24}}"""))
        assertEquals("MQA Studio · 24/352.8 original", track.mqa?.label)
        assertNull(Track.parse(JSONObject("""{"track_id": 4, "title": "Plain", "quality": "16/44.1"}""")).mqa)
        val album = AlbumSummary.parse(JSONObject("""{"offset": 9, "title": "A", "subtitle": "B", "quality": "24/44.1", "mqa": {"studio": false, "original_rate": 176400, "bits": 24}}"""))
        val version = AlbumVersion(album, "MQA · 24/44.1", main = true, current = true)
        assertEquals("24-bit / 44.1 kHz · MQA · 24/176.4 original", version.format)
        assertEquals("24-bit / 44.1 kHz", AlbumVersion(album.copy(mqa = null), "", main = false, current = false).format)
        val sent = Mqa.parse(JSONObject("""{"studio": false, "original_rate": 96000, "bits": 24, "untouched": true}"""))!!
        assertTrue(sent.untouched)
        assertEquals("MQA: sent untouched to the DAC", Mqa.UNTOUCHED)
        assertFalse(Mqa.parse(JSONObject("""{"studio": false, "original_rate": 96000, "bits": 24}"""))!!.untouched)
    }

    @Test
    fun the_Audio_Devices_switch_says_what_it_does_and_patches_mqa_dac() {
        assertEquals("""{"output":{"mqa_dac":true}}""", Mqa.dacPatch(true).toString())
        assertTrue(Mqa.dacNote(true).startsWith("An MQA track goes to this DAC untouched"))
        assertTrue(Mqa.dacNote(false).startsWith("Off, an MQA track plays as the PCM it is"))
        assertTrue(DevicePage(JSONObject("""{"id": "x", "kind": "upnp", "output": {"mqa_dac": true}}""")).mqaDac)
        assertFalse(LibraryView.FACET_IDS.contains("mqa"))   // MQA is under Format (item 423)
    }
}
