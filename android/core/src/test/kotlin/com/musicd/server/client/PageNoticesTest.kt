package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The page's notices as it tells the app of them (item 69, public/app/native-notices.js). */
class PageNoticesTest {
    @Test fun `the server's notice and the update offer read, an empty one none`() {
        val p = PageNotices.parse("""{"notice":{"lines":["The music folder “A” isn't there — …","  "],"error":true,"buttons":["Forget “A”"]},
            "update":{"text":"Mandarin v1.1 is ready","notes":"- faster","now":"Update","later":true,"error":false}}""")
        assertEquals(ServerNotice(listOf("The music folder “A” isn't there — …"), true, listOf("Forget “A”")), p.notice)
        assertEquals(UpdateOffer("Mandarin v1.1 is ready", "- faster", "Update", true, false), p.update)
        assertNull("busy: no Update to tap", PageNotices.parse("""{"update":{"text":"Downloading…","now":null,"later":false}}""").update!!.now)
        assertEquals(PageNotices(), PageNotices.parse("""{"notice":{"lines":[]},"update":{"text":""}}"""))
        assertEquals(PageNotices(), PageNotices.parse("not json"))
        assertEquals(PageNotices(), PageNotices.parse(null))
    }
}
