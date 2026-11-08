package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The DAC's real bits and the Dither of a device's page (item 301), as the page's app/device-dither.js has them (test/device-dither-page.test.js). */
class DeviceDitherTest {
    private fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[{"n":256,"on":true}],"output":$output}"""))

    @Test fun `where Mandarin makes the PCM, the dither's row says the one in use and at which bit`() {
        assertNull("not upsampled: no rows", page("""{"mode":"original"}""").ditherRow)
        assertNull("made DSD: no rows", page("""{"mode":"max","dsd_out":256}""").ditherRow)
        assertEquals(DeviceDither.Row("Dither", "At the word’s depth", "Flat"), page("""{"mode":"max"}""").ditherRow)
        assertEquals(DeviceDither.Row("Dither", "At 20 bits", "Shaped, 5th order"), page("""{"mode":"x2","dither":"ns5","real_bits":20}""").ditherRow)
        assertEquals("sent", page("""{"mode":"max"}""").realBitsValue)
        assertEquals("21", page("""{"mode":"max","real_bits":21}""").realBitsValue)
    }

    @Test fun `a pick is a PATCH of dither or real_bits, and the contract's labels are their names`() {
        assertEquals("""{"output":{"dither":"ns3"}}""", DeviceDither.pick("ns3").toString())
        assertEquals("""{"output":{"real_bits":20}}""", DeviceDither.pickBits("20").toString())
        assertEquals("""{"output":{"real_bits":"sent"}}""", DeviceDither.pickBits("sent").toString())
        assertEquals("Flat", DeviceDither.used(null).name)
        assertEquals(Contract.labels["settings-device.dither-choice"], DeviceDither.ALL.map { it.name })
        assertEquals(Contract.labels["settings-device.realbits"], DeviceDither.REAL_BITS.map { it.label })
    }

    @Test fun `Headroom when upsampling is offered where Mandarin upsamples or makes DSD, Auto by its absence (item 348)`() {
        assertNull("not upsampled: no row", page("""{"mode":"original"}""").headroom)
        assertEquals("auto", page("""{"mode":"x2"}""").headroom)
        assertEquals("auto", page("""{"mode":"original","dsd_out":256}""").headroom)
        assertEquals("off", page("""{"mode":"max","headroom":"off"}""").headroom)
        assertEquals("""{"output":{"headroom":"off"}}""", DeviceDither.pickHeadroom("off").toString())
        assertEquals(Contract.labels["settings-device.upsample-headroom"], DeviceDither.HEADROOM.map { it.label })
    }

    @Test fun `the signal's line in red is the one the server names, where it is one of the lines (item 348)`() {
        val red = Signal.of(JSONObject("""{"lines":["FLAC 24/88.2 kHz ↑×2","Gaussian ×2 · 24/88.2 kHz"],"steps":[],"alert":1}"""))!!
        assertEquals(1, red.alert)
        assertNull(Signal.of(JSONObject("""{"lines":["FLAC 24/88.2 kHz ↑×2"],"steps":[]}"""))!!.alert)
        assertNull("no such line", Signal.of(JSONObject("""{"lines":["FLAC"],"steps":[],"alert":3}"""))!!.alert)
    }
}
