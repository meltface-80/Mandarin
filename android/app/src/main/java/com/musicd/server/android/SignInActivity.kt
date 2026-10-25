package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.musicd.server.client.Account
import com.musicd.server.client.ServerClient
import java.util.concurrent.Executors

/**
 * Signing this phone in to MusicD Server — or, on a brand-new server, creating
 * its one account. No other device is needed: the app has already found the
 * server on the home Wi-Fi (ConnectActivity).
 *
 * The password never leaves the phone. Account/Srp prove it to the server, and
 * the server has to prove it knows the account in return, so the app won't
 * sign in to anything that isn't your server.
 *
 * Or none of that (item 161): a server with its sign-in switched off lets the phone straight in at home or on the
 * tailnet ([join]), and a brand-new one can be used without an account at all ("Use without an account").
 */
class SignInActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()

    private lateinit var title: TextView
    private lateinit var intro: TextView
    private lateinit var userBox: EditText
    private lateinit var passBox: EditText
    private lateinit var pass2Label: TextView
    private lateinit var pass2Box: EditText
    private lateinit var go: Button
    private lateinit var status: TextView
    private lateinit var form: LinearLayout
    private lateinit var openButton: Button
    private var creating = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Store.server(this) == null) { toConnect(); return }
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        fun label(text: String) = TextView(this).apply {
            this.text = text
            setTextColor(0xFFBFC7CE.toInt())
            textSize = 13f
            setPadding(0, px(18), 0, px(6))
        }
        fun box(type: Int) = EditText(this).apply {
            inputType = type
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 18f
        }

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(24), px(40), px(24), px(24))
        }
        title = TextView(this).apply {
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 26f
            typeface = Typeface.DEFAULT_BOLD
        }
        intro = TextView(this).apply {
            setTextColor(0xFFBFC7CE.toInt())
            textSize = 15f
            setPadding(0, px(8), 0, 0)
        }
        col.addView(title)
        col.addView(intro)

        form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        form.addView(label("Username"))
        userBox = box(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS).apply {
            Store.username(this@SignInActivity)?.let { setText(it) }
        }
        form.addView(userBox)
        form.addView(label("Password"))
        passBox = box(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        form.addView(passBox)
        pass2Label = label("Password again")
        form.addView(pass2Label)
        pass2Box = box(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD).apply {
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_GO) { submit(); true } else false }
        }
        form.addView(pass2Box)
        passBox.setOnEditorActionListener { _, id, _ ->
            if (!creating && id == EditorInfo.IME_ACTION_GO) { submit(); true } else false
        }
        go = Button(this).apply { setOnClickListener { submit() } }
        form.addView(go, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = px(24) })
        openButton = Button(this).apply {
            text = "Use without an account"
            visibility = View.GONE
            setOnClickListener { useOpen() }
        }
        form.addView(openButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = px(12) })
        form.visibility = View.GONE
        col.addView(form)

        status = TextView(this).apply {
            setTextColor(0xFFBFC7CE.toInt())
            textSize = 14f
            setPadding(0, px(16), 0, px(8))
        }
        col.addView(status)
        col.addView(Button(this).apply {
            text = "Change server"
            setOnClickListener { toConnect() }
        })
        col.addView(TextView(this).apply {
            text = "Forgot the password? On the server run\ndocker exec musicd-server /app/server/bin/mandarin-server reset-password\nthen create the account again here."
            setTextColor(0xFF6B737A.toInt())
            textSize = 12f
            setPadding(0, px(24), 0, 0)
        })

        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF0E1012.toInt())
            isFillViewport = true
            addView(col)
        }
        Insets.pad(scroll)
        setContentView(scroll)
        check()
    }

    override fun onDestroy() {
        work.shutdownNow()
        super.onDestroy()
    }

    private fun account() = Account(ServerClient(Store.server(this)!!, 8000))

    private fun check() {
        title.text = "Mandarin"
        intro.text = "Checking ${Store.server(this)}…"
        work.execute {
            val st = runCatching { account().status() }
            main.post {
                if (isFinishing) return@post
                st.onSuccess { s ->
                    // Settings → Account switching the sign-in on with no account yet: the account made here first.
                    val make = intent.getBooleanExtra(EXTRA_CREATE, false)
                    when {
                        s.openHere && !make -> join()
                        s.setupRequired && s.canSetup -> showForm(create = true, offerOpen = !s.open)
                        s.setupRequired && s.open -> {
                            title.text = "Join at home"
                            intro.text = "This Mandarin server is used without an account, on its home network and its " +
                                "Tailscale network only. Join the Wi-Fi the server is on, or Tailscale, and try again."
                            status.text = ""
                        }
                        s.setupRequired -> {
                            title.text = "Create the account at home"
                            intro.text = "This Mandarin server has no account yet. For safety it can only be created " +
                                "from the home network — join the Wi-Fi the server is on and try again."
                            status.text = ""
                        }
                        else -> showForm(create = false)
                    }
                }.onFailure { e ->
                    title.text = "Can't reach the server"
                    intro.text = "${Store.server(this)} didn't answer (${e.message ?: e.javaClass.simpleName}). " +
                        "Check the container is running and this phone is on the same network."
                }
            }
        }
    }

    private fun showForm(create: Boolean, offerOpen: Boolean = false) {
        creating = create
        openButton.visibility = if (offerOpen) View.VISIBLE else View.GONE
        title.text = if (create) "Create your account" else "Sign in"
        intro.text = if (create)
            "Choose a username and password — you'll use them on every device. The password never leaves this phone." +
                (if (offerOpen) " Or use Mandarin without an account: anything on your home network or your Tailscale " +
                    "network can then use it without signing in — handy for a TV showing the shelf or the wall." else "")
        else "Sign in to ${Store.server(this)}. The password never leaves this phone."
        pass2Label.visibility = if (create) View.VISIBLE else View.GONE
        pass2Box.visibility = if (create) View.VISIBLE else View.GONE
        passBox.imeOptions = if (create) EditorInfo.IME_ACTION_NEXT else EditorInfo.IME_ACTION_GO
        go.text = if (create) "Create account" else "Sign in"
        form.visibility = View.VISIBLE
        (if (userBox.text.isNullOrEmpty()) userBox else passBox).requestFocus()
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = Build.MODEL
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model"
    }

    private fun submit() {
        val user = userBox.text.toString().trim()
        val pass = passBox.text.toString()
        if (user.isEmpty()) { status.text = "Enter a username."; return }
        if (creating) {
            if (pass.length < 8) { status.text = "Use at least 8 characters for the password."; return }
            if (pass != pass2Box.text.toString()) { status.text = "The two passwords don't match."; return }
        } else if (pass.isEmpty()) { status.text = "Enter your password."; return }
        go.isEnabled = false
        status.text = if (creating) "Creating the account…" else "Signing in…"
        val create = creating
        work.execute {
            val result = runCatching {
                if (create) account().create(user, pass, deviceName()) else account().signIn(user, pass, deviceName())
            }
            main.post {
                if (isFinishing) return@post
                go.isEnabled = true
                result.onSuccess { s ->
                    Store.setToken(this, s.token, s.username)
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }.onFailure { e ->
                    status.text = e.message ?: e.javaClass.simpleName
                    passBox.selectAll()
                }
            }
        }
    }

    /** The sign-in is off here: this phone made a device, no password asked. */
    private fun join() {
        intro.text = "Joining ${Store.server(this)}…"
        signedInBy { account().join(deviceName()) }
    }

    /** A new server used without an account: the sign-in switched off, this phone made a device. */
    private fun useOpen() {
        openButton.isEnabled = false
        status.text = "Setting up…"
        signedInBy { account().setOpen(true, deviceName()) ?: account().join(deviceName()) }
    }

    private fun signedInBy(token: () -> String) {
        work.execute {
            val result = runCatching(token)
            main.post {
                if (isFinishing) return@post
                openButton.isEnabled = true
                result.onSuccess { t ->
                    Store.setToken(this, t)
                    startActivity(Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }.onFailure { e -> status.text = e.message ?: e.javaClass.simpleName }
            }
        }
    }

    companion object {
        /** Make the account, even where the sign-in is off (Settings → Account, Ask for a sign-in, with no account yet). */
        const val EXTRA_CREATE = "create"
    }

    private fun toConnect() {
        startActivity(Intent(this, ConnectActivity::class.java))
        finish()
    }
}
