package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings as the server answers and the page says it (item 76): the version, the account's devices, the API keys. */
class SettingsTest {
    @Test fun `the version at the list's foot, and its C# server's when that is another`() {
        assertEquals("Mandarin v1.0 (Build 17)", SettingsLists.version(JSONObject("""{"current":"1.0.17"}""")))
        assertEquals("Mandarin v2", SettingsLists.version(JSONObject("""{"current":"2"}""")))
        assertEquals("Mandarin v1.0 (Build 17) · bringing its C# server up to date",
            SettingsLists.version(JSONObject("""{"current":"1.0.17","csharp":{"version":"1.0.16","matched":false,"phase":"fetching"}}""")))
        assertEquals("Mandarin v1.0 (Build 17) · C# server v1.0.16 (pull the image again to update it)",
            SettingsLists.version(JSONObject("""{"current":"1.0.17","is_docker":true,"csharp":{"version":"1.0.16","matched":false,"phase":"failed"}}""")))
        assertEquals("the same: nothing more", "Mandarin v1.0 (Build 17)", SettingsLists.version(JSONObject("""{"current":"1.0.17","csharp":{"version":"1.0.17","matched":true}}""")))
        assertNull(SettingsLists.version(JSONObject("{}")))
        assertNull(SettingsLists.version(null))
    }

    @Test fun `the devices signed in, each said as the page says it`() {
        val now = 10_000_000_000L
        val a = AccountDevices.parse(JSONObject("""{"username":"lewis","devices":[
            {"id":"1","name":"Pixel","kind":"android","current":true,"last_seen":$now},
            {"id":"2","name":"Firefox","kind":"browser","current":false,"last_seen":${now - 3 * 3600_000}}]}"""))
        assertEquals("Signed in as lewis", a.who)
        assertEquals("Android app · this device", a.devices[0].sub(now))
        assertEquals("Browser · 3 hours ago", a.devices[1].sub(now))
        assertEquals("active now", SignedInDevice.ago(now - 60_000, now))
        assertEquals("12 min ago", SignedInDevice.ago(now - 12 * 60_000, now))
        assertEquals("1 hour ago", SignedInDevice.ago(now - 60 * 60_000, now))
        assertEquals("3 days ago", SignedInDevice.ago(now - 72 * 3600_000, now))
        assertEquals("Signed in as ?", AccountDevices.parse(JSONObject("""{"username":null}""")).who)
    }

    @Test fun `a new password is tried only once it can be`() {
        assertEquals("Enter your current password.", AccountDevices.passwordProblem("", "longenough", "longenough"))
        assertEquals("Use at least 8 characters for the new password.", AccountDevices.passwordProblem("old", "short", "short"))
        assertEquals("The two new passwords don't match.", AccountDevices.passwordProblem("old", "longenough", "longenougH"))
        assertNull(AccountDevices.passwordProblem("old", "longenough", "longenough"))
    }

    @Test fun `an API key as the server has it, and what the box and the line under it say`() {
        val none = ApiKey.parse(JSONObject("""{"set":false,"check":null}"""))
        assertEquals("Paste FanArt.tv API key…", none.placeholder("Paste FanArt.tv API key…"))
        assertEquals("Not set", none.status)
        assertNull(none.badge)
        val ok = ApiKey.parse(JSONObject("""{"set":true,"masked":"ab…yz","check":"ok"}"""))
        assertEquals("✓", ok.badge)
        assertEquals("Checked and working — ab…yz", ok.placeholder(""))
        assertEquals("✓ Checked and working: ab…yz", ok.status)
        val bad = ok.copy(check = "invalid")
        assertEquals("✕", bad.badge)
        assertTrue(bad.bad)
        assertEquals("Not accepted — paste a new one", bad.placeholder(""))
        assertEquals("The service refused this key (ab…yz). Check it was copied in full.", bad.status)
        val unasked = ok.copy(check = null)
        assertFalse(unasked.ok)
        assertEquals("Saved — ab…yz", unasked.placeholder(""))
        assertEquals("Current: ab…yz — couldn’t reach the service to check it.", unasked.status)
        val discogs = ApiKeySpec.ALL[0]
        assertEquals("Discogs token saved — checked and working", discogs.saved(ok))
        assertEquals("Saved, but Discogs refused this token", discogs.saved(bad))
        assertEquals("Discogs token saved", discogs.saved(unasked))
    }

    @Test fun `the lists in the page's order, and Settings' address`() {
        assertEquals(listOf("account", "folders", "streaming", "playback", "identify", "setup", "backup", "system"), SettingsLists.HOME.map { it.pane })
        assertEquals("Downloads", SettingsLists.SETUP[7].title)
        assertEquals("API Keys", SettingsLists.SETUP.last().title)
        assertEquals("settings/home", ShellRoute.settings())
        assertEquals("settings/metadata", ShellRoute.settings("metadata"))
    }
}
