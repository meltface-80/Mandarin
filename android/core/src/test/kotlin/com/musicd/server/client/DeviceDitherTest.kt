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
}
