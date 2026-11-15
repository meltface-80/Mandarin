package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Edit album's Match by sound (item 419) and the tally under AcoustID's key, worded as the page words them (album-editor-sound.js, settings.js). */
class SoundMatchTest {
    private fun job(j: String) = SoundJob.parse(JSONObject(j))

    @Test fun progressAsThePageSaysIt() {
        assertEquals("Fingerprinting 3 of 12 tracks… On the server, a track at a time.", job("""{"state":"fingerprinting","done":2,"of":12}""").said.text)
        assertEquals("Fingerprinting 1 of 1 track…", job("""{"state":"fingerprinting","done":0,"of":1}""").said.bold)
        assertEquals("Fingerprinting the tracks… On the server, a track at a time.", job("""{"state":"fingerprinting","done":0,"of":0}""").said.text)
        assertEquals(SoundJob.STARTING, job("""{"state":"fingerprinting"}""").said)
        assertEquals("Asking AcoustID… 4 of 12 tracks (three a second).", job("""{"state":"asking","done":4,"of":12}""").said.text)
        assertEquals("Asking MusicBrainz for the releases…", job("""{"state":"fetching","done":0,"of":3}""").said.bold)
        assertTrue(job("""{"state":"asking"}""").working)
        assertFalse(job("""{"state":"none"}""").working)
        assertFalse(job("""{"state":"busy","title":"Other"}""").finished)
    }

    @Test fun plainAnswers() {
        fun said(answer: String, error: String? = null) =
            job("""{"state":"done","answer":"$answer","error":${if (error == null) "null" else "\"$error\""},"releases":[]}""").said
        assertEquals(Said("No AcoustID key.", " Add an AcoustID key in Settings → API Keys."), said("needs-key"))
        assertEquals("AcoustID refused the key. Check it in Settings → API Keys.", said("refused").text)
        assertEquals("AcoustID asks to wait. Try again in a few minutes.", said("limited").text)
        assertEquals("AcoustID can't be reached. Try again later.", said("unreachable").text)
        assertEquals("AcoustID doesn't know these recordings. Try Find match, or the barcode.", said("no-match").text)
        assertEquals("Matching by sound didn't work (MusicBrainz didn't give those releases).", said("failed", "MusicBrainz didn't give those releases").text)
        assertEquals("AcoustID doesn't know these recordings.", job("""{"state":"done","answer":null,"releases":[]}""").said.bold)
    }

    @Test fun releasesOffered() {
        val j = job("""{"state":"done","answer":null,"done":2,"of":2,"releases":[{"mbid":"hidden-gem","title":"Hidden Gem","artist":"Real Artist",
            "year":1999,"release_year":2009,"edition":"Remaster","country":"GB","track_count":4,"missing_tracks":0,"extra_tracks":0,"heard":4,"tracks_heard":4,
            "confidence":95,"reasons":["matched by sound: 4 of 4 tracks","4 of 4 tracks' lengths agree","the title differs"]},
            {"mbid":"x","title":"Comp","artist":"","year":null,"track_count":20,"heard":1,"tracks_heard":4,"confidence":40,"reasons":["matched by sound: 1 of 4 tracks"]}]}""")
        assertEquals("By sound: the releases these tracks are on. Tap the right one to apply.", j.said.text)
        val r = j.releases[0]
        assertEquals("Real Artist — Hidden Gem", r.name)
        assertEquals("1999 · this pressing 2009 · Remaster · GB · 4 tracks · 4 of 4 tracks by sound", r.line)
        assertEquals("95 % sure", r.sure)
        assertTrue(r.accent)
        assertEquals("4 of 4 tracks' lengths agree · the title differs", r.why)
        val o = j.releases[1]
        assertEquals("Comp", o.name)
        assertEquals("20 tracks · 1 of 4 tracks by sound", o.line)
        assertFalse(o.accent)
        assertNull(o.why)
    }

    @Test fun theTallyUnderAcoustIdsKey() {
        assertEquals("By sound: 12 albums matched so far, 844 still to look at, when the Album Scanner is on.", SoundTally(12, 844, "off").line)
        assertEquals("By sound: 1 album matched so far, 3 still to look at, in the Album Scanner's hours.", SoundTally(1, 3, "hours").line)
        assertEquals("By sound: 5 albums matched so far, 0 still to look at.", SoundTally(5, 0, "off").line)
        val k = ApiKey.parse(JSONObject("""{"set":true,"masked":"••••-key","check":"ok","sound":{"matched":2,"waiting":7,"held":null}}"""))
        assertEquals("By sound: 2 albums matched so far, 7 still to look at.", k.sound?.line)
        assertNull(ApiKey.parse(JSONObject("""{"set":false,"masked":"","check":null}""")).sound)
    }

    @Test fun aMatchBySoundSaysSo() {
        assertEquals("matched by sound, chosen by you", AlbumMatch.how("sound", "acoustid", false))
        assertEquals("matched by sound", AlbumMatch.how("", "acoustid", false))
    }
}
