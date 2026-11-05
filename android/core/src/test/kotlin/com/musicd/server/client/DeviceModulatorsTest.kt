package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The Modulator of a device's page (item 303), as the page's app/device-modulators.js has it (test/device-modulator-page.test.js). */
class DeviceModulatorsTest {
    private fun page(output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[{"n":64,"on":true},{"n":128,"on":true},{"n":256,"on":true}],"output":$output}"""))

    @Test fun `with PCM as DSD on, one row saying the modulator in use at that rate`() {
        assertNull("PCM as DSD off: no row", page("""{"mode":"original"}""").modRow)
        assertEquals(DeviceModulators.Row("Modulator", "PCM made DSD256", "7th order wide"), page("""{"dsd_out":256,"dsd_mod":"7w"}""").modRow)
        assertEquals("none set: the 7th order", "7th order", page("""{"dsd_out":64}""").modRow?.value)
        assertEquals("the wide one isn't made at DSD64", "7th order", page("""{"dsd_out":64,"dsd_mod":"7w"}""").modRow?.value)
        assertEquals("the ninth isn't made at DSD256", "7th order", page("""{"dsd_out":256,"dsd_mod":"9"}""").modRow?.value)
        assertEquals("9th order", page("""{"dsd_out":128,"dsd_mod":"9"}""").modRow?.value)
    }

    @Test fun `its list greys out what isn't made at that rate, and a pick is a PATCH of dsd_mod`() {
        assertEquals("Modulator for DSD256", DeviceModulators.title(256))
        assertEquals(listOf("7th order", "7th order wide", "9th order — not at DSD256"), DeviceModulators.choices(256).map { it.name })
        assertEquals(listOf(true, true, false), DeviceModulators.choices(256).map { it.offered })
        assertEquals(listOf(true, false, true), DeviceModulators.choices(64).map { it.offered })
        assertEquals("7w", DeviceModulators.used("7w", 128).value)
        assertEquals("""{"output":{"dsd_mod":"9"}}""", DeviceModulators.pick("9").toString())
        // The contract's labels are its names.
        assertEquals(Contract.labels["settings-device.modulator-choice"], DeviceModulators.ALL.map { it.name })
    }
}
