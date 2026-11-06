package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A device's Output as recipes (item 320), as the page's app/device-recipes.js has them (device-recipes-page.test.js). */
class DeviceRecipesTest {
    private val rates = """[{"hz":44100,"on":true},{"hz":48000,"on":true},{"hz":352800,"on":true},{"hz":384000,"on":true},{"hz":705600,"on":true},{"hz":768000,"on":true}]"""
    private val dsd = """[{"n":64,"on":true},{"n":128,"on":true},{"n":256,"on":true}]"""
    private fun page(output: String, rates: String = this.rates, dsd: String = this.dsd) =
        DevicePage(JSONObject("""{"id":"su","name":"SU-1","kind":"upnp","rates":$rates,"dsd":$dsd,"output":$output}"""))
    private fun on(p: DevicePage) = p.recipes.filter { it.on }.map { it.id }

    @Test fun `offered by what it takes, each in words for the device`() {
        val p = page("""{"mode":"original","bits":"auto","flac32":true}""")
        assertEquals(listOf("bitperfect", "standard", "gaussian", "gaussian-min", "very-long", "dsd", "custom"), p.recipes.map { it.id })
        assertTrue(p.recipes[1].words.startsWith("Each track to the highest rate SU-1 takes (705.6 kHz for a CD), 24-bit, in SoX’s steep filter"))
        assertEquals("DSD256, 7th order", p.recipes[5].name)
        assertTrue(p.recipes[5].words.contains("11.2896 MHz") && p.recipes[5].words.contains("−207 dB"))
        // A CD's rates only, and no DSD: the file as it is, and Custom.
        assertEquals(listOf("bitperfect", "custom"), page("{}", """[{"hz":44100,"on":true},{"hz":48000,"on":true},{"hz":96000,"on":true}]""", "[]").recipes.map { it.id })
        // Its owner's highest rate (item 240) holds the CD to 352.8 kHz; its real bits in the shaped one's words.
        val held = page("""{"mode":"max","max_rate":384000,"real_bits":20}""")
        assertTrue(held.recipes[1].words.contains("(352.8 kHz for a CD)"))
        assertTrue(held.recipes[4].words.contains("dithered at SU-1’s 20 real bits"))
    }

    @Test fun `the one in use marked, Custom where none is, minphase the standard filter`() {
        assertEquals(listOf("bitperfect"), on(page("""{"mode":"original","bits":"auto"}""")))
        assertEquals(listOf("standard"), on(page("""{"mode":"max","bits":24}""")))
        assertEquals(listOf("gaussian-min"), on(page("""{"mode":"max","filter":"gaussian","filter_hires":"gaussian-hires","phase":"minimum"}""")))
        assertEquals(listOf("dsd"), on(page("""{"mode":"original","dsd_out":256,"filter":"gaussian-steep"}""")))
        assertEquals(listOf("custom"), on(page("""{"mode":"max","filter":"long"}""")))
        assertEquals(listOf("custom"), on(page("""{"mode":"max","filter":"minphase","phase":"minimum"}""")))
    }

    @Test fun `a pick sends its settings and nothing else, Custom and the one in use nothing`() {
        val r = page("""{"mode":"max"}""").recipes
        assertEquals(JSONObject("""{"output":{"mode":"original","dsd_out":"off"}}""").similar(DeviceRecipes.pick(r[0])), true)
        assertEquals(256, DeviceRecipes.pick(r.first { it.id == "dsd" })!!.getJSONObject("output").getInt("dsd_out"))
        assertNull(DeviceRecipes.pick(r.first { it.id == "standard" }))
        assertNull(DeviceRecipes.pick(r.last()))
    }

    @Test fun `Advanced is open where it was opened, or while Custom is in use`() {
        val p = page("""{"mode":"max"}""")
        assertFalse(DeviceRecipes.advancedOpen(p.recipes, opened = false))
        assertTrue(DeviceRecipes.advancedOpen(p.recipes, opened = true))
        assertTrue(DeviceRecipes.advancedOpen(page("""{"mode":"x2"}""").recipes, opened = false))
    }
}
