package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The app's log holds no personal data (bug list item 121): each line goes through LogRedact before it is written. The
 * lines here are as the app wrote them in the owner's logs of 20 and 21 October.
 */
class LogRedactTest {
    private fun same(s: String) = assertEquals(s, LogRedact.line(s))

    @Test fun `addresses of every kind`() {
        assertEquals("REACH  to the server at http://[address] (home)", LogRedact.line("REACH  to the server at http://192.168.0.57:3500 (home)"))
        assertEquals("REACH  the live look at http://[address] missed", LogRedact.line("REACH  the live look at http://127.0.0.1:34500 missed"))
        assertEquals("server GET /api/health → SocketTimeoutException: failed to connect to /[ip] (port 3500) from /[ip] (port 50928) after 5000ms",
            LogRedact.line("server GET /api/health → SocketTimeoutException: failed to connect to /192.168.0.57 (port 3500) from /192.0.0.4 (port 50928) after 5000ms"))
        assertEquals("Away: away: using [ip]:3500", LogRedact.line("Away: away: using 100.92.159.80:3500"))
        assertEquals("route [ip] via [ip]", LogRedact.line("route 10.2.0.0/24 via 10.2.0.1"))
        assertEquals("v6 [ip], [ip] and [ip]", LogRedact.line("v6 fd7a:115c:a1e0::1, fe80::1c2b:3aff:fe4d:5e6f%wlan0 and 2001:db8:85a3:0:0:8a2e:370:7334"))
        assertEquals("the phone at [mac]", LogRedact.line("the phone at 34:7E:5C:D9:64:62"))
        assertEquals("on [host]", LogRedact.line("on my-server.tail1234.ts.net"))
        assertEquals("by [email]", LogRedact.line("by someone@example.com"))
    }

    @Test fun `rooms, devices and keys`() {
        assertEquals("NET    server GET /api/zone-state?zone=[…]&wait_for=22&timeout=20000 → ok in 1188 ms",
            LogRedact.line("NET    server GET /api/zone-state?zone=RINCON_347E5CD9646201400&wait_for=22&timeout=20000 → ok in 1188 ms"))
        assertEquals("rooms: 2, last RINCON_[id]", LogRedact.line("rooms: 2, last RINCON_347E5CD9646201400"))
        assertEquals("the phone PHONE_[id]", LogRedact.line("the phone PHONE_L5BgOVpYfQVC"))
        assertEquals("device [id]", LogRedact.line("device 0f8fad5b-d9cb-469f-a165-70867728950e"))
        assertEquals("token=[…] and Bearer […]", LogRedact.line("token=abc123def and Bearer eyJhbGciOiJIUzI1NiJ9"))
        assertEquals("key […]", LogRedact.line("key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"))
    }

    @Test fun `what is listened to and searched for, and files and folders`() {
        assertEquals("server GET /api/album/extras?title=[…]&artist=[…]&day=1 → ok in 12 ms",
            LogRedact.line("server GET /api/album/extras?title=Battle%20Born&artist=The%20Killers&day=1 → ok in 12 ms"))
        assertEquals("server GET /api/search?q=[…]", LogRedact.line("server GET /api/search?q=1984"))
        assertEquals("server GET /api/library/albums?count=30&sort=random&dir=asc&seed=69646 → ok",
            LogRedact.line("server GET /api/library/albums?count=30&sort=random&dir=asc&seed=69646 → ok"))
        assertEquals("FileNotFoundException: [path]: open failed: ENOENT",
            LogRedact.line("FileNotFoundException: /storage/emulated/0/Music/The Killers/Battle Born/01 Flesh and Bone.flac: open failed: ENOENT"))
        assertEquals("the folder content://[address][path]", LogRedact.line("the folder content://com.android.externalstorage.documents/tree/primary%3AMusic"))
        assertEquals("no album '[…]' here", LogRedact.line("no album 'Battle Born' here"))
        assertEquals("said \"[…]\"", LogRedact.line("said \"Road trip\""))
    }

    @Test fun `what the log is for is kept`() {
        same("10-21 08:00:18.578 !! NET    server GET /api/image/al-701-a7eea0c0eb?size=300 → SocketException: Connection reset after 660 ms")
        same("NAV    to settings/away (108 ms after the last tap); stack: home > settings/home > settings/setup")
        same("UI     JANK: a frame took 145 ms on home")
        same("TAP    at 917,1082 px on settings/system")
        same("SNAP   phone player: playing, track 1 of 9, at 215.404 of 324.68, volume 13, revision 90")
        same("APP    started: Mandarin 1.1.0 (327), Android 16 (API 36)")
        same("LOGCAT 10-20 23:42:23.659  8735  8735 W WindowOnBackDispatcher: sendCancelIfRunning: isInProgress=false callback=androidx.activity.OnBackPressedDispatcher\$Api34Impl\$createOnBackAnimationCallback\$1@c54ddd2")
        same("server POST /api/phone/state → ok in 58 ms")
        same("[auth] wrong password from […]")
    }

    @Test fun `nothing personal is left in a whole log`() {
        val log = javaClass.getResource("/log-redact-sample.txt")?.readText() ?: SAMPLE
        val out = log.lines().joinToString("\n") { LogRedact.line(it) }
        for (bad in listOf("192.168.", "100.92.", "10.2.0.2", "127.0.0.1", "RINCON_347E", "PHONE_L5B", "Killers", "Battle", "Mostly", "Autumn", "Tellurian", "Soen", "Ane%20Brun"))
            assertFalse("$bad left in", out.contains(bad))
    }

    private companion object {
        val SAMPLE = """
            10-20 23:42:32.190    NET    server GET /api/album/extras?title=Battle%20Born&artist=The%20Killers&day=1 → ok in 12 ms
            10-20 23:42:32.208    NET    server GET /api/artist-albums?artist=The%20Killers → ok in 6 ms
            10-20 23:43:38.819 !! NET    server GET /api/lastfm/similar-albums?artist=Mostly%20Autumn → ok in 4246 ms
            10-21 00:14:52.077 !! NET    server GET /api/phone/commands?after=9&wait=25000 → SocketTimeoutException: failed to connect to /192.168.0.57 (port 3500) from /10.2.0.2 (port 56048) after 5000ms after 5006 ms
                                   LOGCAT 10-21 00:15:10.117  8735  8830 I Away    : away: using 100.92.159.80:3500
            10-21 00:24:57.156 !! NET    server GET /api/lastfm/similar-albums?artist=Ane%20Brun → ok in 3573 ms
            10-21 07:36:07.234 !! NET    server GET /api/lastfm/similar-albums?artist=Soen → ok in 3469 ms
            10-21 08:05:02.332 !! NET    server GET /api/album/extras?title=Tellurian&artist=Soen → SocketException: Connection reset after 4006 ms
            10-21 08:00:23.954 !! REACH  the live look at http://127.0.0.1:34500 missed (1 in a row)
            10-20 23:54:04.126    SNAP   rooms: 1, last RINCON_347E5CD9646201400
            10-21 00:15:22.195    NET    phone GET /api/zone-state?zone=PHONE_L5BgOVpYfQVC → ok in 15 ms
        """.trimIndent()
    }
}
