package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings → Audio Devices as the page lists and shows each player (item 89). */
class AudioDevicesTest {
    @Test fun `the list, its rows' words, the hidden ones and the local note`() {
        val l = AudioDevices.parse(JSONObject("""{"devices":[
            {"id":"k","name":"Kitchen","kind":"sonos","model":"Sonos Five","online":true,"state":"playing"},
            {"id":"w","name":"Lounge","kind":"upnp","profile":{"label":"WiiM"},"renamed":true,"network_name":"WiiM Pro","online":false,"can_toggle":true,"enabled":false},
            {"id":"h","name":"Old","kind":"upnp","hidden":true,"online":true}],
            "local":{"platform":"linux","count":0,"docker":true}}"""))
        assertEquals(listOf("k", "w"), l.shown.map { it.id })
        assertEquals("Sonos Five", l.rows[0].sub)
        assertEquals("Playing", l.rows[0].stateShown)
        assertTrue(l.rows[0].playing)
        assertEquals("WiiM · WiiM Pro", l.rows[1].sub)
        assertEquals("Off", l.rows[1].stateShown)
        assertEquals("Offline", l.rows[1].state)
        assertEquals("hidden", l.rows[2].sub)
        assertEquals("Idle", l.rows[2].state)
        assertTrue(l.localNote.startsWith("To play through a USB DAC"))
        assertEquals("", AudioDevices.parse(JSONObject("""{"away":true,"local":{"platform":"linux","docker":true}}""")).localNote)
        assertEquals("1 device hidden", AudioDevices.hiddenCount(1))
        assertEquals("3 devices hidden", AudioDevices.hiddenCount(3))
    }

    @Test fun `hide and unhide's words`() {
        assertEquals("Hide / unhide", AudioDevices.hideWord(false, 2))
        assertEquals("Cancel", AudioDevices.hideWord(true, 0))
        assertEquals("OK", AudioDevices.hideWord(true, 1))
        assertTrue(AudioDevices.hideSaid(2, 1).startsWith("2 devices hidden, 1 device shown again.\n\nA hidden device"))
        assertEquals("1 device shown again.\n\nThey are back on the list, switched off until you switch them on.", AudioDevices.hideSaid(0, 1))
    }

    @Test fun `a renderer's page, its words, chips, output and the changes they make`() {
        val d = DevicePage(JSONObject("""{"id":"w","kind":"upnp","name":"Lounge","network_name":"WiiM Pro","renamed":true,"model":"WiiM Pro","manufacturer":"Linkplay",
            "ip":"1.2.3.4","playable":true,"events":"live","online":false,"last_seen":5,"first_seen":0,"can_toggle":true,"enabled":true,"radio":true,"editable":true,
            "rates":[{"hz":44100,"on":true,"source":"verified"},{"hz":88200,"on":true,"source":"user"},{"hz":176400,"on":false,"source":"off"}],
            "bits":[{"n":24,"on":true,"source":"verified"},{"n":32,"on":true,"source":"advertised"}],"dsd":[{"n":64,"on":true,"source":"later"}],
            "containers":["flac","dsd"],"output":{"mode":"x4","bits":"auto","flac32":true},"levelling":{"mode":"album","target":-14,"unknown":-5}}"""))
        assertEquals("WiiM Pro · Linkplay", d.desc)
        assertTrue(d.showRadio)
        assertEquals(listOf("Model" to "WiiM Pro", "Made by" to "Linkplay", "Address" to "1.2.3.4", "Standard" to "UPnP AV / DLNA", "Updates" to "Sent by the device (events)",
            "Last seen" to "T5", "First seen" to "—"), d.about { "T$it" })
        assertEquals(listOf("44.1", "88.2", "176.4"), d.rates.map { it.label })
        assertEquals("✎", d.rates[1].mark)
        assertNull(d.rates[2].mark)
        assertTrue(d.dsd[0].later)
        assertTrue(d.chipEditable(d.dsd[0]))
        assertEquals("FLAC, DSD", d.formats)
        assertEquals("""{"caps":{"user":{"rates":[44100]}}}""", d.tapped(d.rates[1]).toString())
        assertEquals("""{"caps":{"user":{"rates":[44100,88200,176400]}}}""", d.tapped(d.rates[2]).toString())
        assertEquals("""{"caps":{"user":{"dsd":[]}}}""", d.tapped(d.dsd[0]).toString())
        assertEquals("A 16-bit/44.1 kHz file plays as 32-bit/88.2 kHz FLAC (×2).", d.example)
        assertTrue(d.outputInfo.endsWith("goes out at 24 or 32 bits."))
        assertEquals("""{"output":{"bits":24}}""", d.segment("bits", "24").toString())
        assertFalse(d.depths[2].off)
        assertEquals("Not on the network", d.forgetName)
        assertTrue(d.capNotes[0].startsWith("DSD files go to it as they are"))
    }

    @Test fun `the filter is offered while upsampling, standard until set to whole track`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val standard = page("""{"mode":"x4","bits":"auto","flac32":false}""")
        assertTrue(standard.showFilter)
        assertEquals("standard", standard.filter)
        assertEquals(listOf("Standard", "Whole track", "Min phase", "Gentle"), standard.filters.map { it.label })
        // Four to a row on a phone: none longer than "Whole track", the longest that fits a quarter of it (item 250).
        assertTrue(standard.filters.map { it.label }.toString(), standard.filters.all { it.label.length <= "Whole track".length })
        assertEquals("""{"output":{"filter":"whole"}}""", standard.segment("filter", "whole").toString())
        val whole = page("""{"mode":"max","bits":"auto","flac32":false,"filter":"whole"}""")
        assertEquals("whole", whole.filter)
        assertTrue(whole.filterNote.startsWith("One filter as long as the track"))
        assertFalse(page("""{"mode":"original","bits":"auto","flac32":false,"filter":"whole"}""").showFilter)
    }

    @Test fun `minimum phase and gentle are made ahead as whole track is, and offered with PCM as DSD too`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val min = page("""{"mode":"max","filter":"minphase","whole":{"made":4,"making":null,"waiting":2}}""")
        assertTrue(min.filterNote.startsWith("Whole track’s filter made minimum phase"))
        assertEquals("4 tracks made · 2 waiting", min.wholeLine)
        val gentle = page("""{"mode":"x2","filter":"gentle"}""")
        assertTrue(gentle.filterNote.startsWith("Whole track’s filter rolling off from 90%"))
        assertEquals("""{"output":{"filter":"gentle"}}""", min.segment("filter", "gentle").toString())
        // The file as it is, but made DSD from PCM: the filter takes it to 705.6 kHz on the way, so it is offered.
        assertTrue(page("""{"mode":"original","dsd_out":256}""").showFilter)
    }

    @Test fun `the highest rate offers the caps below the device's top and holds the example to it`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","bits":[],"dsd":[],"output":$output,
            "rates":[{"hz":44100,"on":true},{"hz":176400,"on":true},{"hz":352800,"on":true},{"hz":384000,"on":true}]}"""))
        val auto = page("""{"mode":"max","bits":"auto","flac32":false}""")
        assertTrue(auto.showMaxRate)
        assertEquals("auto", auto.maxRateValue)
        assertEquals(listOf("Auto", "96k", "192k"), auto.maxRates.map { it.label })
        assertEquals("A 16-bit/44.1 kHz file plays as 24-bit/352.8 kHz FLAC.", auto.example)
        assertEquals("""{"output":{"max_rate":192000}}""", auto.segment("max_rate", "192000").toString())
        val capped = page("""{"mode":"max","bits":"auto","flac32":false,"max_rate":192000}""")
        assertEquals("192000", capped.maxRateValue)
        assertEquals("A 16-bit/44.1 kHz file plays as 24-bit/176.4 kHz FLAC (×4).", capped.example)
        assertTrue(capped.maxRateNote.startsWith("Nothing goes above 192 kHz (176.4 kHz"))
        assertFalse(DevicePage(JSONObject("""{"kind":"upnp","bits":[],"dsd":[],"rates":[{"hz":44100,"on":true},{"hz":96000,"on":true}]}""")).showMaxRate)
    }

    @Test fun `with the whole-track filter, how the making goes`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        assertEquals("12 tracks made · making “01 Song” · 3 waiting",
            page("""{"mode":"max","filter":"whole","whole":{"made":12,"making":"01 Song","waiting":3}}""").wholeLine)
        assertEquals("1 track made", page("""{"mode":"max","filter":"whole","whole":{"made":1,"making":null,"waiting":0}}""").wholeLine)
        assertNull(page("""{"mode":"max"}""").wholeLine)
    }

    @Test fun `DSD as PCM offers off and two cuts and sends the cut in Hz`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val off = page("""{"mode":"original"}""")
        assertEquals("off", off.dsdLowpassValue)
        assertEquals(listOf("Off", "50 kHz", "30 kHz"), off.dsdLowpasses.map { it.label })
        assertEquals("""{"output":{"dsd_lowpass":30000}}""", off.segment("dsd_lowpass", "30000").toString())
        assertEquals("""{"output":{"dsd_lowpass":"off"}}""", off.segment("dsd_lowpass", "off").toString())
        val cut = page("""{"mode":"original","dsd_lowpass":30000}""")
        assertEquals("30000", cut.dsdLowpassValue)
        assertTrue(cut.dsdLowpassNote.contains("above 30 kHz taken off"))
    }

    @Test fun `PCM as DSD is offered where the device takes DSD, its multiples only, and sends the multiple`() {
        fun page(dsd: String, output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":$dsd,"output":$output}"""))
        assertFalse(page("""[{"n":64,"on":false}]""", """{"mode":"original"}""").showDsdOut)
        val off = page("""[{"n":64,"on":true},{"n":128,"on":true},{"n":256,"on":false}]""", """{"mode":"original"}""")
        assertTrue(off.showDsdOut)
        assertEquals("off", off.dsdOutValue)
        assertEquals(listOf("Off", "DSD64", "DSD128", "DSD256"), off.dsdOuts.map { it.label })
        assertEquals(listOf(false, false, false, true), off.dsdOuts.map { it.off })
        assertNull(off.dsdOutLine)
        assertEquals("""{"output":{"dsd_out":128}}""", off.segment("dsd_out", "128").toString())
        assertEquals("""{"output":{"dsd_out":"off"}}""", off.segment("dsd_out", "off").toString())
        val on = page("""[{"n":64,"on":true}]""", """{"mode":"original","dsd_out":64,"whole":{"made":2,"making":"03 Song","waiting":1}}""")
        assertEquals("64", on.dsdOutValue)
        assertTrue(on.dsdOutNote.contains("made DSD64 ahead of playing"))
        assertEquals("2 tracks made · making “03 Song” · 1 waiting", on.dsdOutLine)
        assertNull("the whole-track filter’s line is the filter’s", on.wholeLine)
    }

    @Test fun `a sound device's note says how it plays, a Mac's by Core Audio`() {
        val mac = DevicePage(JSONObject("""{"kind":"local","found_by":"This Mac (Core Audio)"}"""))
        assertTrue(mac.capNotes[0].startsWith("Mandarin sets the device to each track’s rate"))
        val linux = DevicePage(JSONObject("""{"kind":"local","found_by":"This computer (ALSA)"}"""))
        assertTrue(linux.capNotes[0].startsWith("Mandarin sends the rates that are on; ALSA"))
    }

    @Test fun `a lone rate stays on, and a phone's and a Sonos room's words`() {
        val one = DevicePage(JSONObject("""{"kind":"upnp","editable":true,"rates":[{"hz":48000,"on":true}]}"""))
        assertNull(one.tapped(one.rates[0]))
        val phone = DevicePage(JSONObject("""{"kind":"phone","shared":false,"enabled":true,"radio":false,"playable":false,"dsp":{}}"""))
        assertEquals("A phone running the Mandarin app", phone.desc)
        assertTrue(phone.showShared)
        assertFalse(phone.showRadio)
        assertTrue(phone.showDsp)
        assertEquals("Off. The app plays what it is given as it is.", phone.dspNote)
        assertEquals("Named in the app on the phone.", phone.nameNote)
        assertEquals(" · A name for Mandarin only; the Sonos app keeps its own.", DevicePage(JSONObject("""{"kind":"sonos"}""")).sonosNameNote)
        assertEquals("-14 LUFS (Default)", DevicePage.TARGETS[0].words)
        assertEquals("-5 dB (Default)", DevicePage.UNKNOWNS[5].words)
        assertEquals("Volume levelling: Album", DevicePage.levelSaid("album"))
    }
}
