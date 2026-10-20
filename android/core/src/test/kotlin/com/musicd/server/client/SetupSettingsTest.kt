package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Setup's small pages as the page says them (item 78). */
class SetupSettingsTest {
    @Test fun `what Record labels says, off and on, with its logos`() {
        assertEquals("Off. 2 albums name a label in their tags; 1 has none.",
            SetupSettings.labelsNote(JSONObject("""{"enabled":false,"tagged":2,"untagged":1}""")))
        assertEquals("3 labels. 1 album names a label in its tags, 2 have one looked up; 0 have none. 2 logos.",
            SetupSettings.labelsNote(JSONObject("""{"enabled":true,"count":3,"tagged":1,"looked_up":2,"untagged":0,"discogs":true,"logos":2}""")))
        assertEquals("1 label. 1 album names a label in its tags; 4 have none (MusicBrainz and Discogs didn't know them). Logos need a Discogs token or a FanArt.tv key (Settings → Setup → API Keys).",
            SetupSettings.labelsNote(JSONObject("""{"enabled":true,"count":1,"tagged":1,"untagged":4}""")))
        assertEquals("No labels yet: none of the albums' files carry a LABEL tag.", SetupSettings.labelsNote(JSONObject("""{"enabled":true,"count":0}""")))
        assertEquals("2 labels. 0 albums name a label in their tags; 0 have none. Looking up labels and logos now…",
            SetupSettings.labelsNote(JSONObject("""{"enabled":true,"count":2,"scanning":true}""")))
    }

    @Test fun `Force rescan's answer, the folder depth, Smart Picks' words`() {
        assertEquals("Labels re-read from the library's tags and folders: 1 label.", SetupSettings.rescanSaid(JSONObject("""{"started":false,"count":1}""")))
        assertEquals("Done", SetupSettings.rescanWord(JSONObject("""{"started":false}""")))
        assertEquals("Full rescan started — this may take several minutes. Label data will update as results come in.", SetupSettings.rescanSaid(JSONObject("""{"started":true}""")))
        assertEquals("Rescan started", SetupSettings.rescanWord(JSONObject("{}")))
        assertEquals("Off — using file label tags", SetupSettings.depthStatus(0))
        assertEquals("Using folder depth 2", SetupSettings.depthStatus(2))
        assertEquals("Smart Picks will build at 04:00", SetupSettings.hourSaid(4))
        assertEquals("21:00", SetupSettings.HOURS[21].words)
    }

    @Test fun `UI Settings read from the page's prefs, and a change made in them`() {
        val p = WallPrefs.parse("""{"layout":"list","tile":"1.25","text":"1.1","title":"1","menu":"1.5"}""")
        assertEquals("1.1", SetupSettings.uiValue(p, "text"))
        assertEquals("1", SetupSettings.uiValue(p, "title"))
        assertEquals("1.5", SetupSettings.uiValue(p, "menu"))
        assertEquals("list", SetupSettings.uiValue(p, "layout"))
        assertEquals("1.25", SetupSettings.uiValue(p, "tile"))
        assertEquals("2", WallPrefs.parse(SetupSettings.prefsWith("""{"layout":"auto"}""", "layout", "2")).layout)
        assertEquals("random", WallPrefs.parse(SetupSettings.prefsWith(null, "labelOrder", "random")).labelOrder)
        assertEquals("every choice is one the prefs take", SetupSettings.TILE.map { it.value }, SetupSettings.TILE.map { SetupSettings.uiValue(WallPrefs.parse("""{"tile":"${it.value}"}"""), "tile") })
    }

    @Test fun `what the share card links to, each on or off, and its review`() {
        val l = ShareLinkSettings.parse(JSONObject("""{"services":{"all":[{"id":"qobuz","name":"Qobuz"},{"id":"spotify","name":"Spotify"}],"enabled":["qobuz"]},
            "reviews":{"all":[{"id":"allmusic-artist","name":"AllMusic","chip":"AllMusic artist"}],"enabled":[]},"card":{"review":false}}"""))
        assertEquals(listOf(LinkToggle("qobuz", "Qobuz", true), LinkToggle("spotify", "Spotify", false)), l.services)
        assertEquals("the chip's words", "AllMusic artist", l.reviews[0].name)
        assertEquals(listOf("qobuz"), l.onServices.map { it.id })
        assertEquals(false, l.cardReview)
        assertEquals(true, ShareLinkSettings.parse(JSONObject("{}")).cardReview)
        assertEquals("Off. The card shows the cover, title, artist and year — no write-up.", ShareLinkSettings.reviewNote(false))
    }

    @Test fun `the server's Tailscale in words`() {
        val run = AwayState.parse(JSONObject("""{"available":true,"enabled":true,"state":"Running","serving":true,"online":true,"health":[],"dns_name":"mandarin.tail.ts.net","address":"http://100.1.2.3:8080","hostname":"mandarin"}"""))
        assertEquals("Connected", run.status)
        assertEquals("100.1.2.3:8080", run.shownAddress)
        assertEquals(null, run.warning)
        assertEquals("Running, but not online on the tailnet — the server is rebinding it, then starting it afresh", run.copy(online = false).warning)
        assertEquals("Tailscale warns: a; b", run.copy(health = listOf("a", "b")).warning)
        assertEquals("Connecting…", run.copy(serving = false).status)
        assertEquals("Off", run.copy(enabled = false).status)
        assertEquals("Not signed in yet", run.copy(state = "NeedsLogin").status)
        assertEquals(null, run.copy(state = "NeedsLogin", online = false).warning)
        assertEquals(true, run.connectedInfo(true).contains("under This phone below"))
        assertEquals(false, AwayState.parse(JSONObject("""{"available":false}""")).available)
    }

    @Test fun `a list shows the choice made, else the first, and nothing while the list is still empty`() {
        val hours = SetupSettings.HOURS
        assertEquals("21:00", Choice.words(hours, "21"))
        assertEquals("00:00", Choice.words(hours, "nope"))
        // Audio Devices' zones before they have come (item 100): the app crashed on the first of none.
        assertEquals("", Choice.words(emptyList(), "kitchen"))
    }
}
