package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** This phone's USB DAC as its page says it (item 89). */
class UsbViewTest {
    @Test fun `a DAC allowed and streaming, as the page says it`() {
        val u = UsbView(JSONObject("""{"attached":true,"permission":true,"direct":true,"fixed":false,"limit":60,"dsd_mode":"native_le","dsd_native":[64,128],"dsd_dop":[64],
            "device":{"name":"DragonFly Cobalt","manufacturer":"AudioQuest"},
            "info":{"uac":2,"speed":"high","sync":"async","rates":[44100,96000],"bits":[24],"dsd":false,"volume_control":true,"current_rate":96000},
            "stream":{"rate":96000,"bits":24,"kind":"pcm","dsd":null,"level":30,"software_volume":false,"volume_db":{"min":-80,"max":0},"stats":{"running":true,"feedback":6.0004,"underruns":1,"errors":0}}}"""))
        assertEquals("AudioQuest DragonFly Cobalt", u.name)
        assertEquals("USB Audio Class 2 · high speed · async", u.classLine)
        assertEquals("96 kHz", u.clock)
        assertEquals(60, u.limit)
        assertTrue(u.showDsd)
        assertEquals(listOf("native", "native_le", "dop", "pcm"), u.dsdChoices.map { it.value })
        assertEquals("Natively: DSD64, DSD128. As DoP: DSD64. DSD files go to the DAC as DSD, bit-perfect, each 32-bit word the other way round — for a DAC that plays noise with the usual order; DoP where the rate isn’t native.", u.dsdNote)
        assertEquals("96 kHz · 24-bit · volume 30% (DAC range -80.0 to 0.0 dB) · feedback 6.000 frames/packet · 1 underrun", u.streaming)
        assertTrue(u.fixedNote.startsWith("Off. The volume slider and the phone’s volume buttons drive the DAC’s own control"))
    }

    @Test fun `nothing on the port, and one not yet allowed`() {
        val none = UsbView(JSONObject("""{"attached":false,"permission":false,"direct":false,"error":null,"dsd_native":[],"dsd_dop":[]}"""))
        assertFalse(none.attached)
        assertNull(none.error)
        assertFalse(none.showDsd)
        assertNull(none.streaming)
        val ask = UsbView(JSONObject("""{"attached":true,"permission":false,"device":{"name":"USB Audio","manufacturer":null},"error":"Permission refused — tap Allow to ask again"}"""))
        assertEquals("USB Audio", ask.name)
        assertEquals("Permission refused — tap Allow to ask again", ask.error)
        assertEquals("Off. The phone plays through Android’s mixer, at the mixer’s rate.", ask.directNote)
        assertEquals(listOf("pcm"), ask.dsdChoices.map { it.value })
    }
}
