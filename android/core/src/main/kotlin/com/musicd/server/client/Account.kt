package com.musicd.server.client

import org.json.JSONObject

/**
 * The server's one account, from the phone: create it on first run, or sign
 * in. Either way the password never leaves the phone — [Srp] proves it — and
 * the server has to prove it knows the account too, so a sign-in to anything
 * but your own server fails. The result is this phone's own token, which the
 * server can sign out from Settings.
 *
 * With the sign-in switched off (item 161) there is no password at all: at home or on the tailnet the phone
 * [join]s, and is a device of its own just the same.
 */
class Account(private val client: ServerClient) {

    /** [open]: the sign-in is off; [openHere]: and that lets this phone in, where it is now. */
    class Status(val setupRequired: Boolean, val canSetup: Boolean, val signedIn: Boolean, val username: String?,
                 val open: Boolean = false, val openHere: Boolean = false) {
        companion object {
            const val PATH = "/api/auth/status"

            /** /api/auth/status's answer [j]. */
            fun parse(j: JSONObject) = Status(
                setupRequired = j.optBoolean("setup_required"),
                canSetup = j.optBoolean("can_setup"),
                signedIn = j.optBoolean("signed_in"),
                username = j.optString("username").takeIf { it.isNotEmpty() && !j.isNull("username") },
                open = j.optBoolean("open"),
                openHere = j.optBoolean("open_here")
            )
        }
    }

    class Session(val token: String, val username: String)

    class AuthException(message: String) : Exception(message)

    fun status(): Status = Status.parse(client.getJson(Status.PATH))

    /** The sign-in off: this phone made a device, no password asked; its token. */
    fun join(deviceName: String): String =
        call("/api/auth/join", JSONObject().put("want_token", true).put("kind", "android").put("device_name", deviceName)).getString("token")

    /**
     * Ask for a sign-in ([open] false) or not (Settings → Account; a new server's "Use without an account"). A phone
     * not yet a device is made one: its token, else null.
     */
    fun setOpen(open: Boolean, deviceName: String = ""): String? =
        call("/api/auth/open", JSONObject().put("open", open).put("want_token", true).put("kind", "android").put("device_name", deviceName))
            .optString("token").takeIf { it.isNotEmpty() }

    /** First run: make the account (home network only) and sign this phone in. */
    fun create(username: String, password: String, deviceName: String, iterations: Int = Srp.ITERATIONS): Session {
        val v = Srp.makeVerifier(username, password, iterations)
        val j = call("/api/auth/setup", JSONObject()
            .put("username", username).put("salt", v.salt).put("verifier", v.verifier)
            .put("iterations", iterations).put("want_token", true)
            .put("kind", "android").put("device_name", deviceName))
        return Session(j.getString("token"), j.optString("username", Srp.normUser(username)))
    }

    fun signIn(username: String, password: String, deviceName: String): Session {
        val ch = call("/api/auth/challenge", JSONObject().put("username", username))
        val start = Srp.clientStart()
        val proof = try {
            Srp.clientProof(username, password, ch.getString("salt"), ch.getInt("iterations"), start, ch.getString("B"))
        } catch (e: IllegalArgumentException) {
            throw AuthException("That server gave an answer no MusicD Server would — not signing in.")
        }
        val j = call("/api/auth/verify", JSONObject()
            .put("id", ch.getString("id")).put("A", start.A).put("M1", proof.M1)
            .put("want_token", true).put("kind", "android").put("device_name", deviceName))
        if (j.optString("M2") != proof.expectM2) {
            throw AuthException("That server couldn't prove it's yours — not signing in.")
        }
        return Session(j.getString("token"), j.optString("username", Srp.normUser(username)))
    }

    fun signOut() {
        runCatching { client.post("/api/auth/logout", JSONObject()) }
    }

    /**
     * The password changed (Settings → Account, item 76), as the page changes it: the current one proved again (the
     * server proving itself too), then the new one's verifier sent; the devices signed in stay signed in.
     */
    fun changePassword(username: String, current: String, new: String) {
        val ch = call("/api/auth/challenge", JSONObject().put("username", username))
        val start = Srp.clientStart()
        val proof = try {
            Srp.clientProof(username, current, ch.getString("salt"), ch.getInt("iterations"), start, ch.getString("B"))
        } catch (e: IllegalArgumentException) {
            throw AuthException("The server couldn't prove it's yours.")
        }
        val j = call("/api/auth/verify", JSONObject().put("id", ch.getString("id")).put("A", start.A).put("M1", proof.M1).put("purpose", "reauth"))
        if (j.optString("M2") != proof.expectM2) throw AuthException("The server couldn't prove it's yours.")
        val v = Srp.makeVerifier(username, new, Srp.ITERATIONS)
        call("/api/auth/password", JSONObject().put("salt", v.salt).put("verifier", v.verifier).put("iterations", Srp.ITERATIONS))
    }

    private fun call(path: String, body: JSONObject): JSONObject = try {
        client.post(path, body, 20_000)
    } catch (e: ServerClient.ServerException) {
        throw AuthException(e.message ?: "HTTP ${e.status}")
    }
}
