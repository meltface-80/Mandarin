package com.musicd.server.android

import android.content.Context
import android.net.ConnectivityManager
import android.system.Os
import android.util.Log
import java.io.File
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentLinkedDeque

/**
 * Soloist on the phone (bug list item 148; its "Soloist test" icon): Spotify's own
 * Linux player, Soloist, run on the phone itself, its lossless sound played by the app.
 *
 * Soloist is a Linux program for glibc; the phone's processor is the one it's built for (64-bit ARM), its C library
 * isn't. So it runs under proot (android/soloist/runtime.sh): a Debian file tree in the app's folder ([root]) with
 * Debian 13's glibc, /etc written here for the phone (its DNS, Android's certificates), and Spotifast's PulseAudio
 * stand-in, which hands Soloist's sound to [SoloistPhoneSound] over 127.0.0.1. Soloist itself comes from Spotify
 * ([SoloistPhoneFiles.download]). Everything that happens is put in [log], for the report the screen shares.
 */
object SoloistPhone {
    private const val TAG = "SoloistPhone"

    /** What happened, newest last (the report's). Never the key. */
    val log = ConcurrentLinkedDeque<String>()
    @Volatile var secret = ""

    fun note(s: String) {
        val line = if (secret.isNotEmpty()) s.replace(secret, "<key>") else s
        log.addLast("%tT  %s".format(System.currentTimeMillis(), line))
        while (log.size > 600) log.pollFirst()
        Log.i(TAG, line)
    }

    fun dir(c: Context) = File(c.filesDir, "soloist")
    fun root(c: Context) = File(dir(c), "root")
    /** Soloist's account and cache, as Soloist sees them, and where that is here. */
    const val DATA = "/var/soloist/data"
    fun data(c: Context) = File(root(c), DATA.removePrefix("/"))
    private fun native(c: Context, name: String) = File(c.applicationInfo.nativeLibraryDir, name)

    /** proot and its runtime are in this APK (a build without runtime.sh's has none). */
    fun inBuild(c: Context) = native(c, "libproot.so").exists() && runCatching { c.assets.list("soloist-root")!!.isNotEmpty() }.getOrDefault(false)

    /** The packages the runtime was made from, as runtime.sh noted them. */
    fun versions(c: Context) = runCatching { c.assets.open("soloist-root/VERSIONS").bufferedReader().readText().trim() }.getOrDefault("(none)")

    // ------------------------------------------------------------ the file tree

    /** The Debian tree made afresh from the APK's, with /etc for this phone and its network now. */
    fun prepare(c: Context) {
        val r = root(c)
        copyAssets(c, "soloist-root", r)
        for (d in listOf("tmp", "home", "dev", "proc", "sys", "etc/ssl/certs", "opt/soloist", "var/soloist/cache", DATA.removePrefix("/"))) File(r, d).mkdirs()
        File(r, "tmp").setWritable(true, false)
        val uid = android.os.Process.myUid()
        File(r, "etc/passwd").writeText("root:x:0:0:root:/root:/bin/sh\nmandarin:x:$uid:$uid:mandarin:/home:/bin/sh\n")
        File(r, "etc/group").writeText("root:x:0:\nmandarin:x:$uid:\n")
        File(r, "etc/hosts").writeText("127.0.0.1 localhost\n::1 localhost ip6-localhost\n")
        File(r, "etc/nsswitch.conf").writeText("passwd: files\ngroup: files\nhosts: files dns\n")
        File(r, "etc/os-release").writeText("PRETTY_NAME=\"Debian GNU/Linux 13 (trixie)\"\nNAME=\"Debian GNU/Linux\"\nVERSION_ID=\"13\"\nID=debian\n")
        // One machine id for this phone, kept across runs (as a Linux machine keeps /etc/machine-id).
        val id = File(dir(c), "machine-id")
        if (!id.exists()) id.writeText(java.util.UUID.randomUUID().toString().replace("-", "") + "\n")
        id.copyTo(File(r, "etc/machine-id"), overwrite = true)
        val dns = nameservers(c)
        File(r, "etc/resolv.conf").writeText(dns.joinToString("") { "nameserver $it\n" })
        note("prepare: nameservers ${dns.joinToString(", ")}")
        note("prepare: ${certificates(r)} certificates from Android")
        // proot's own talloc, under the name it links (libtalloc.so.2), where its loader looks.
        val bionic = File(dir(c), "bionic").apply { mkdirs() }
        val talloc = File(bionic, "libtalloc.so.2")
        talloc.delete()
        Os.symlink(native(c, "libtalloc.so").path, talloc.path)
        File(dir(c), "proot-tmp").mkdirs()
        // The loader the libraries' search starts at (Debian: /lib → usr/lib).
        File(r, "usr").mkdirs()
        val usrLib = File(r, "usr/lib")
        if (!usrLib.exists()) Os.symlink("../lib", usrLib.path)
    }

    private fun copyAssets(c: Context, from: String, to: File) {
        val names = c.assets.list(from) ?: return
        if (names.isEmpty()) {
            to.parentFile?.mkdirs()
            c.assets.open(from).use { i -> to.outputStream().use { i.copyTo(it) } }
            to.setReadable(true, false)
            to.setExecutable(true, false)
            return
        }
        to.mkdirs()
        for (n in names) copyAssets(c, "$from/$n", File(to, n))
    }

    /** The network's DNS servers (IPv4 first; glibc reads three at most), then a public one. */
    private fun nameservers(c: Context): List<String> {
        val cm = c.getSystemService(ConnectivityManager::class.java)
        val found = runCatching { cm.getLinkProperties(cm.activeNetwork)?.dnsServers.orEmpty() }.getOrDefault(emptyList())
        val list = found.sortedBy { it is Inet6Address }.mapNotNull { a: InetAddress ->
            val h = a.hostAddress ?: return@mapNotNull null
            if (a is Inet6Address && a.isLinkLocalAddress && !h.contains('%')) null else h
        }
        return (list.take(2) + "1.1.1.1").distinct()
    }

    /** Android's trusted certificates, as one bundle where Debian keeps it. */
    private fun certificates(r: File): Int {
        val dirs = listOf(File("/apex/com.android.conscrypt/cacerts"), File("/system/etc/security/cacerts")).filter { it.isDirectory }
        val seen = HashSet<String>()
        val pem = StringBuilder()
        for (d in dirs) for (f in d.listFiles().orEmpty().sortedBy { it.name }) {
            if (!seen.add(f.name)) continue
            val t = runCatching { f.readText() }.getOrNull() ?: continue
            val a = t.indexOf("-----BEGIN CERTIFICATE-----"); val b = t.indexOf("-----END CERTIFICATE-----")
            if (a >= 0 && b > a) pem.append(t, a, b + 25).append('\n')
        }
        File(r, "etc/ssl/certs/ca-certificates.crt").writeText(pem.toString())
        File(r, "etc/ssl/cert.pem").writeText(pem.toString())
        return seen.size
    }

    // ------------------------------------------------------------ running under proot

    /** Soloist as Soloist sees it, or null before it's downloaded. */
    fun soloist(c: Context): String? = SoloistPhoneFiles.binary(c)?.let { "/" + it.relativeTo(root(c)).path }

    /**
     * [program] (a path in the tree) with [args], under proot. [env] is added; [noSeccomp] turns off proot's seccomp
     * speed-up, which some phones' kernels refuse.
     */
    fun command(c: Context, program: String, args: List<String>, env: Map<String, String> = emptyMap(), noSeccomp: Boolean = false): ProcessBuilder {
        val cmd = listOf(native(c, "libproot.so").path, "--kill-on-exit", "-r", root(c).path,
            "-b", "/dev", "-b", "/proc", "-b", "/sys", "-w", "/home", program) + args
        val pb = ProcessBuilder(cmd).directory(dir(c)).redirectErrorStream(true)
        val e = pb.environment()
        e["PROOT_LOADER"] = native(c, "libproot-loader.so").path
        e["PROOT_TMP_DIR"] = File(dir(c), "proot-tmp").path
        e["LD_LIBRARY_PATH"] = File(dir(c), "bionic").path + ":" + c.applicationInfo.nativeLibraryDir
        e["HOME"] = "/home"
        e["TMPDIR"] = "/tmp"
        e["PATH"] = "/usr/bin:/bin"
        e["LANG"] = "C"
        e.remove("LD_PRELOAD")
        if (noSeccomp) e["PROOT_NO_SECCOMP"] = "1"
        e.putAll(env)
        return pb
    }

    /** Runs [program] to its end (at most [seconds]), noting each line it writes (and handing it to [line]); its exit code, or null if it didn't end. */
    fun runOnce(c: Context, label: String, program: String, args: List<String>, noSeccomp: Boolean, seconds: Long = 30, line: (String) -> Unit = {}): Int? {
        note("$label: $program ${args.joinToString(" ")}")
        val p = runCatching { command(c, program, args, noSeccomp = noSeccomp).start() }
            .getOrElse { note("$label: couldn't start proot: ${it.message}"); return -1 }
        val reader = Thread { runCatching { p.inputStream.bufferedReader().forEachLine { note("$label| $it"); line(it) } } }.apply { isDaemon = true; start() }
        val ended = p.waitFor(seconds, java.util.concurrent.TimeUnit.SECONDS)
        if (!ended) { p.destroyForcibly(); note("$label: still running after ${seconds}s; stopped"); return null }
        reader.join(2_000)
        val code = p.exitValue()
        note("$label: exit $code${signal(code)}")
        return code
    }

    /** What an exit code means when a signal ended it (proot passes 128 + the signal on). */
    fun signal(code: Int) = when (code) {
        128 + 31 -> " (SIGSYS: a system call Android's seccomp filter refuses)"
        128 + 11 -> " (SIGSEGV)"
        128 + 9 -> " (SIGKILL)"
        128 + 6 -> " (SIGABRT)"
        127 -> " (not found)"
        126 -> " (can't be run)"
        10 -> " (Soloist's build has expired)"
        else -> ""
    }
}
