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
        assertTrue(l.localNote.startsWith("To play through a USB DAC plugged into the computer Mandarin runs on, install Mandarin Bridge for Linux"))
        assertEquals("a Bridge listed: nothing said", "", AudioDevices.parse(JSONObject("""{"devices":[{"id":"s","kind":"slim"}],"local":{"platform":"linux","count":0}}""")).localNote)
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

    @Test fun `a phone's page has Output for its USB DAC only while one is in use (item 265)`() {
        val dac = DevicePage(JSONObject("""{"kind":"phone","rates":[{"hz":44100,"on":true},{"hz":192000,"on":true}],"bits":[{"n":24,"on":true}],"dsd":[{"n":64,"on":true}],"output":{"mode":"x4","bits":"auto","dsd_out":64}}"""))
        assertTrue(dac.showOutput)
        assertTrue(dac.showDsdOut)
        assertEquals("Through its USB DAC the phone is sent what Output below says; away from home, Opus 256 kbps.", dac.capNotes.first())
        val none = DevicePage(JSONObject("""{"kind":"phone","rates":[],"bits":[],"dsd":[],"output":null}"""))
        assertFalse(none.showOutput)
        assertEquals("At home the phone plays the file as it is; away from home, Opus 256 kbps.", none.capNotes.first())
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
        assertEquals("Auto is 24 bits (item 308)", "A 16-bit/44.1 kHz file plays as 24-bit/88.2 kHz FLAC (×2).", d.example)
        assertTrue(d.outputInfo.endsWith("goes out at 24 or 32 bits."))
        assertEquals("""{"output":{"bits":24}}""", d.segment("bits", "24").toString())
        assertFalse(d.depths[2].off)
        assertEquals("Not on the network", d.forgetName)
        assertTrue(d.capNotes[0].startsWith("DSD files go to it as they are"))
    }

    @Test fun `the filters are offered while upsampling, two rows, CD-rate and hi-res sources, six filters`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val standard = page("""{"mode":"x4","bits":"auto","flac32":false}""")
        assertTrue(standard.showFilter)
        assertEquals("standard", standard.filter)
        assertNull(standard.filterHires)
        assertEquals(listOf("CD-rate sources" to "Standard", "Hi-res sources" to "Same as CD-rate"), standard.filterRows.map { it.label to it.value })
        // Item 298: the three Gaussian filters after the three before them; the hi-res list leads with the same as CD-rate.
        assertEquals(listOf("standard", "gentle", "gaussian", "gaussian-steep", "gaussian-hires", "long", "very-long"), DeviceFilters.choices("filter").map { it.value })
        assertEquals(listOf("Same as CD-rate sources", "Standard", "Gentle", "Gaussian", "Gaussian steep", "Gaussian hi-res", "Long", "Very long"), DeviceFilters.choices("filter_hires").map { it.name })
        assertEquals("Each track is upsampled in the filter for its own rate: 44.1 and 48 kHz in the first, 88.2 kHz and up in the second.", standard.filterNotes.single())
        assertFalse(page("""{"mode":"original","bits":"auto","flac32":false}""").showFilter)
        // A device left at a filter gone is said as the standard one, as the server takes it.
        assertEquals("Standard", page("""{"mode":"max","filter":"whole"}""").filterRows[0].value)
    }

    @Test fun `a filter picked is a PATCH of its row, the one in use ticked, how fast it is made said under them`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val making = "Made as it plays: this server made the last at 3.2× real time, fast enough to keep up."
        val g = page("""{"mode":"max","filter":"gaussian","filter_hires":"gaussian-hires","making":"$making"}""")
        assertEquals(listOf("Gaussian", "Gaussian hi-res"), g.filterRows.map { it.value })
        assertEquals("gaussian", DeviceFilters.current("filter", g.filter, g.filterHires))
        assertEquals("gaussian-hires", DeviceFilters.current("filter_hires", g.filter, g.filterHires))
        assertEquals("same", DeviceFilters.current("filter_hires", "gaussian", null))
        assertEquals("Filter for hi-res sources", DeviceFilters.title("filter_hires"))
        assertEquals("""{"output":{"filter_hires":"same"}}""", DeviceFilters.pick("filter_hires", "same").toString())
        assertEquals("""{"output":{"filter":"gaussian-steep"}}""", DeviceFilters.pick("filter", "gaussian-steep").toString())
        assertEquals(making, g.filterNotes[1])
        // Standard for CD-rate sources and a filter of Mandarin's own for hi-res: its speed said too.
        assertEquals(making, page("""{"mode":"x2","filter_hires":"gentle","making":"$making"}""").filterNotes[1])
        // The standard filter in minimum phase (item 318): Mandarin's own, its speed said; and its Phase.
        val m = page("""{"mode":"x2","phase":"minimum","making":"$making"}""")
        assertEquals(making, m.filterNotes[1])
        assertEquals("minimum", m.phase)
        assertEquals("linear", page("""{"mode":"x2"}""").phase)
        assertEquals("""{"output":{"phase":"minimum"}}""", m.segment("phase", "minimum").toString())
        assertEquals(Contract.labels["settings-device.phase"], DeviceFilters.PHASES.map { it.label })
        // The standard one everywhere: SoX's, nothing of Mandarin's own made.
        assertEquals(1, page("""{"mode":"x2","filter_hires":"standard","making":"$making"}""").filterNotes.size)
        // The file as it is, but made DSD from PCM: the filters take it to 705.6 kHz on the way, so they are offered.
        assertTrue(page("""{"mode":"original","dsd_out":256}""").showFilter)
    }

    @Test fun `an album as one stream is a switch where Mandarin makes what it plays, its note on and off`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val off = page("""{"mode":"x2"}""")
        assertFalse(off.albumStream)
        assertTrue(off.albumStreamNote.startsWith("Each track goes as a file of its own"))
        assertEquals("""{"output":{"album_stream":true}}""", off.albumStreamPatch(true).toString())
        val on = page("""{"mode":"x2","album_stream":true}""")
        assertTrue(on.albumStream)
        assertTrue(on.albumStreamNote.startsWith("An album’s tracks go to this device as one stream"))
    }

    @Test fun `with PCM as DSD on, the filters' note says they are the DSD's, its speed said once under PCM as DSD`() {
        fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[],"output":$output}"""))
        val sr11 = page("""{"mode":"max","filter":"gaussian","filter_hires":"gaussian-hires","dsd_out":256,"making":"Made as it plays: this server made the last at 1.1× real time, too slow to keep up; DSD128 is half the work."}""")
        assertEquals(listOf("With PCM as DSD256 on, these are the filters each track is upsampled with on its way to DSD256: by its own rate, the first or the second."), sr11.filterNotes)
        assertEquals("Made as it plays: this server made the last at 1.1× real time, too slow to keep up; DSD128 is half the work.", sr11.dsdOutLine)
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
        val on = page("""[{"n":64,"on":true}]""", """{"mode":"original","dsd_out":64,"making":"Made as it plays. How fast this server makes DSD64 shows here after its first track."}""")
        assertEquals("64", on.dsdOutValue)
        assertEquals("Each track of the library that isn’t DSD is made DSD64 as it plays, by the modulator below, and sent as a DSF while it is made; Qobuz and Tidal go as PCM.", on.dsdOutNote)
        assertEquals("Made as it plays. How fast this server makes DSD64 shows here after its first track.", on.dsdOutLine)
        assertEquals("its speed is said under PCM as DSD, not the filter", 1, on.filterNotes.size)
    }

    @Test fun `a sound device's note says how it plays`() {
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

    @Test fun `room correction is offered on a renderer's DSP, not a phone's, and lists what is loaded, one a rate, as the page does`() {
        val none = DevicePage(JSONObject("""{"kind":"upnp","dsp":{"enabled":true}}"""))
        assertTrue(none.showRoomCorrection)
        assertEquals(emptyList<DevicePage.IrRow>(), none.irRows)
        assertEquals("Load a response…", none.irLoad)
        assertFalse(DevicePage(JSONObject("""{"kind":"phone","dsp":{}}""")).showRoomCorrection)
        // One kept as item 252 kept it (a single response): a set of one.
        val room = DevicePage(JSONObject("""{"kind":"local","dsp":{"convolution":{"file":"0123456789abcdef.wav","name":"room.wav","rate":44100,"channels":2,"seconds":0.5,"peak_db":-6}}}"""))
        assertEquals(listOf(DevicePage.IrRow("room.wav", "44.1 kHz · 2 channels · 0.5 s · lifts at most −6.0 dB", 44100)), room.irRows)
        assertEquals("Load another…", room.irLoad)
        // A set, as the server keeps it (in order of rate): a row each, a bare one named for what it is.
        val set = DevicePage(JSONObject("""{"kind":"upnp","dsp":{"convolution":[{"file":"a.wav","name":"room-44.wav","rate":44100,"channels":2,"seconds":0.5,"peak_db":-6},{"rate":48000,"channels":1,"seconds":2,"peak_db":3.25}]}}"""))
        assertEquals(listOf(
            DevicePage.IrRow("room-44.wav", "44.1 kHz · 2 channels · 0.5 s · lifts at most −6.0 dB", 44100),
            DevicePage.IrRow("Impulse response", "48 kHz · 1 channel · 2 s · lifts at most +3.3 dB", 48000)), set.irRows)
        assertEquals("Load another…", set.irLoad)
    }
}
