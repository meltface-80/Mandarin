package com.musicd.server.client

/**
 * The server the sign-in screen asks (bug list item 189). It was always the home address: away (Tailscale) that can't
 * be reached, and the screen said the server didn't answer. Now it is the address the app is using ([address]): home,
 * or away the Tailscale one. The server answering is checked to be this phone's own ([ours], [ServerId]) before an
 * account is made, joined or signed in to there. And making the account sends this phone's sign-in ([creating]), so
 * the device it was without an account is the one the server makes anew, not one left behind in the list.
 */
class SignInServer(val address: ServerAddress, private val token: String?, private val keptId: String?) {
    private fun client(withToken: Boolean) = ServerClient(address, 8000, if (withToken) token else null)

    /** For how the server stands, a join or a sign-in. */
    fun account(): Account = Account(client(false))

    /** For making the account: this phone's sign-in sent with it. */
    fun creating(): Account = Account(client(true))

    /** The server answering is this phone's own, or there is nothing to tell by (no id kept, a server from before ids). Blocking. */
    fun ours(): Boolean {
        val answered = runCatching { ServerId.of(client(false).getJson("/api/ping").toString()) }.getOrNull()
        return ServerId.ours(keptId, answered)
    }

    companion object {
        /** The address to sign in on: the one the app is using now ([active]: home, or away), else home's. */
        fun address(home: ServerAddress, active: ServerAddress?): ServerAddress = active ?: home
    }
}
