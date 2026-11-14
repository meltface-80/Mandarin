package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Settings → Backup & restore and Updates as the page says them (item 92). */
class BackupSettingsTest {
    private val date = { ms: Long -> "D$ms" }

    @Test fun `the parts, a size, and the whole database with its size`() {
        assertEquals(listOf("settings", "devices", "collection", "keys", "database", "page", "app"), BackupSettings.backupParts(true))
        assertEquals(listOf("settings", "keys"), BackupSettings.serverParts(listOf("settings", "page", "keys", "app")))
        assertEquals("The whole database (197 KB)", BackupSettings.partName("database", 197_000))
        assertEquals("Players", BackupSettings.partName("devices", 5))
        assertEquals("1 KB", BackupSettings.bytes(12))
        assertEquals("7 MB", BackupSettings.bytes(7_400_000))
        assertEquals("1.5 GB", BackupSettings.bytes(1_500_000_000))
    }

    @Test fun `the server's backups and the phone's files, newest first, each said as the page says it`() {
        val info = JSONObject("""{"backups":[{"id":"a","kind":"auto","created":5,"version":"1.0.17","bytes":7000,"parts":["settings","database"]},
            {"id":"b","created":9,"version":"1.0.16","bytes":2000000,"sealed":true,"label":"Kitchen","parts":["keys","app"]}]}""")
        val phone = JSONArray("""[{"uri":"content://x","name":"m.tar.gz","created":7,"bytes":3000,"parts":[]}]""")
        val all = BackupSettings.list(info, phone)
        assertEquals(listOf("b", "", "a"), all.map { it.id })
        assertEquals("On the server", BackupSettings.title(all[0]))
        assertEquals("On this phone", BackupSettings.title(all[1]))
        assertEquals("Before restore · on the server", BackupSettings.title(all[2]))
        assertEquals("D9 · v1.0.16 · 2 MB · sealed · from Kitchen", BackupSettings.meta(all[0], date))
        assertEquals("D7 · v? · 3 KB · m.tar.gz", BackupSettings.meta(all[1], date))
        assertEquals("Settings, The whole database", BackupSettings.partsLine(all[2]))
        assertEquals(listOf("keys"), BackupSettings.restoreParts(all[0], false))
        assertEquals(BackupSettings.backupParts(true), BackupSettings.restoreParts(all[1], true))
        assertEquals("Delete the backup on the server of D9?", BackupSettings.deleteQuestion(all[0], date))
        assertEquals("Delete the backup file m.tar.gz of D7 from this phone?", BackupSettings.deleteQuestion(all[1], date))
    }

    @Test fun `the questions and what a restore's answer says`() {
        assertEquals("Restore This device's screen settings?", BackupSettings.restoreQuestion(listOf("page")))
        assertEquals("Restore Settings, The whole database? This puts them back for every device, and Mandarin restarts. A backup of how things are now is kept first." +
            " The whole database replaces everything Mandarin knows; your account and sign-ins stay.", BackupSettings.restoreQuestion(listOf("settings", "database")))
        assertEquals("Backed up: 7 KB, D3.", BackupSettings.backedUp(7000, 3, date))
        assertNull(BackupSettings.restoreSaid(JSONObject("""{"ok":false,"cancelled":true}""")))
        assertEquals("Wrong passphrase", BackupSettings.restoreSaid(JSONObject("""{"ok":false,"error":"Wrong passphrase"}""")))
        assertEquals(BackupSettings.CHOOSE_AGAIN, BackupSettings.restoreSaid(JSONObject("""{"ok":true,"app_result":{"choose_again":["local_folder"]}}""")))
        assertNull(BackupSettings.restoreSaid(JSONObject("""{"ok":true,"restarting":true}""")))
        // Item 410: the music folders kept, said, before the folders to choose again.
        val kept = "The backup's music folders (/music/1tb/Music) aren't on this computer: this one's (/data/Storage) kept."
        assertEquals(kept, BackupSettings.restoreSaid(JSONObject().put("ok", true).put("restarting", true).put("folders", kept)))
        assertEquals(kept + " " + BackupSettings.CHOOSE_AGAIN,
            BackupSettings.restoreSaid(JSONObject().put("ok", true).put("folders", kept).put("app_result", JSONObject("""{"choose_again":["local_folder"]}"""))))
    }

    @Test fun `the copies of the database kept before a restore or a switch of builds, among the backups (item 410)`() {
        val info = JSONObject("""{"backups":[{"id":"a","kind":"manual","created":5,"version":"1.3.2","bytes":7000,"parts":["settings"]}],
            "copies":[{"id":"before-restore-2026-11-14-003225","kind":"restore","created":9,"bytes":2000000,"parts":["database"]},
            {"id":"before-dev-2026-11-13-101010","kind":"dev","created":3,"bytes":5000,"parts":["database"]},
            {"id":"before-latest-2026-11-12-101010","kind":"latest","created":1,"bytes":5000,"parts":["database"]}]}""")
        val all = BackupSettings.list(info, null)
        assertEquals(listOf("before-restore-2026-11-14-003225", "a", "before-dev-2026-11-13-101010", "before-latest-2026-11-12-101010"), all.map { it.id })
        val copy = all[0]
        assertEquals(true, copy.isCopy)
        assertEquals("Before the restore of D9 · on the server", BackupSettings.title(copy, date))
        assertEquals("Before switching to development builds · on the server", BackupSettings.title(all[2], date))
        assertEquals("Before switching to the latest release · on the server", BackupSettings.title(all[3], date))
        assertEquals("On the server", BackupSettings.title(all[1], date))
        assertEquals("D9 · 2 MB", BackupSettings.meta(copy, date))
        assertEquals("The whole database only: no settings", BackupSettings.partsLine(copy))
        assertEquals(listOf("database"), BackupSettings.restoreParts(copy, true))
        assertEquals("Delete the copy of the database of D9 from the server?", BackupSettings.deleteQuestion(copy, date))
    }
}
