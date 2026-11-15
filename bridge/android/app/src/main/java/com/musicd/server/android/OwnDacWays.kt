package com.musicd.server.android

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import org.json.JSONArray
import org.json.JSONObject

/**
 * The ways an app may ask Android for a track, each tried on this device's own output (item 434), and the one that
 * makes the output follow a track's rate used for playback.
 *
 * Android has no public way to ask for its direct output, the one that isn't resampled or mixed: which an app's track
 * reaches is the device's to decide by how the track is asked for. On a FiiO R7 a track asked for as media, in float,
 * left the output at 44.1 kHz, Android resampling it; USB Audio Player Pro's Hi-Res Direct driver had the output at
 * each track's own rate. So each way here is tried with a fifth of a second of silence, each at a rate of its own (an
 * output left at the rate the way before set isn't taken for this one's), and the output's rate read as it plays: a
 * way the output followed is one that reaches the DAC at the track's own rate. The first float way that followed is
 * the one played by (float carries a 24-bit sample whole); a 16-bit way that followed is said, never played by.
 *
 * Above 192 kHz Android itself sends an ordinary track to a direct output where the device has one (its audio policy
 * mixes nothing above 192 kHz), and a FiiO R7's Android takes up to 768 kHz from an app: so where no way follows, the
 * first is tried at each rate above 192 kHz Android takes too, and those that reach the DAC are said to Mandarin.
 */
internal object OwnDacWays {
    /** A way: [key] in /dac.json, its words in Settings, whether it carries float, and how its track is made. */
    class Way(val key: String, val words: String, val float: Boolean, val make: (rate: Int, bytes: Int, session: Int) -> AudioTrack)

    /**
     * A way tried at [rate]: the rate Android's music output ran at as it played ([output], 0 unsaid), the rate FiiO's
     * own audio code said the track's output runs at ([fiio], 0 unsaid: [said]), or why it couldn't be tried. Followed
     * where either is the track's rate: a direct output isn't the music output Android is asked about.
     */
    class Tried(val way: Way, val rate: Int, val output: Int, val error: String?, val fiio: Int = 0) {
        val followed: Boolean get() = error == null && (output == rate || fiio == rate)
        /** The rate the DAC was fed: FiiO's word where it said one, else Android's music output's. */
        val fed: Int get() = if (fiio > 0) fiio else output
        fun json(): JSONObject = JSONObject().put("way", way.key).put("rate", rate).put("output_rate", output).put("fiio_rate", fiio)
            .put("followed", followed).put("error", error ?: JSONObject.NULL)
    }

    private const val STEREO = AudioFormat.CHANNEL_OUT_STEREO

    private fun attrs(): AudioAttributes =
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()

    private fun built(rate: Int, bytes: Int, session: Int, enc: Int, mode: Int? = null, offload: Boolean = false): AudioTrack {
        val b = AudioTrack.Builder().setAudioAttributes(attrs())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(enc).setChannelMask(STEREO).build())
            .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(bytes)
        if (session > 0) b.setSessionId(session)
        if (mode != null) b.setPerformanceMode(mode)
        // PCM offloaded: straight to the hardware on some Qualcomm devices (Android 10's own API; the R7 is one).
        if (offload) { if (android.os.Build.VERSION.SDK_INT < 29) throw UnsupportedOperationException("Android 10 or later"); b.setOffloadedPlayback(true) }
        return b.build()
    }

    /** The music stream, as an app before Android 5 asked for a track (and many players still do). */
    @Suppress("DEPRECATION")
    private fun stream(rate: Int, bytes: Int, session: Int, enc: Int): AudioTrack =
        if (session > 0) AudioTrack(AudioManager.STREAM_MUSIC, rate, STEREO, enc, bytes, AudioTrack.MODE_STREAM, session)
        else AudioTrack(AudioManager.STREAM_MUSIC, rate, STEREO, enc, bytes, AudioTrack.MODE_STREAM)

    /** Every way, in the order tried: the one played by before first. */
    val WAYS: List<Way> = listOf(
        Way("media", "media, float (as before)", true) { r, b, s -> built(r, b, s, AudioFormat.ENCODING_PCM_FLOAT) },
        Way("music_stream", "music stream, float", true) { r, b, s -> stream(r, b, s, AudioFormat.ENCODING_PCM_FLOAT) },
        Way("power_saving", "media, float, power-saving", true) { r, b, s -> built(r, b, s, AudioFormat.ENCODING_PCM_FLOAT, AudioTrack.PERFORMANCE_MODE_POWER_SAVING) },
        Way("low_latency", "media, float, low latency", true) { r, b, s -> built(r, b, s, AudioFormat.ENCODING_PCM_FLOAT, AudioTrack.PERFORMANCE_MODE_LOW_LATENCY) },
        Way("offload", "media, float, offloaded", true) { r, b, s -> built(r, b, s, AudioFormat.ENCODING_PCM_FLOAT, offload = true) },
        Way("media_16", "media, 16-bit", false) { r, b, s -> built(r, b, s, AudioFormat.ENCODING_PCM_16BIT) },
        Way("music_stream_16", "music stream, 16-bit", false) { r, b, s -> stream(r, b, s, AudioFormat.ENCODING_PCM_16BIT) },
    )

    /** The rates to try the ways at, the most telling first: each way gets one of its own, never the output's rate now. */
    private val TRY_AT = listOf(96000, 88200, 176400, 192000, 48000, 352800, 384000, 64000)

    /** A rate for each of [count] ways: those Android [taken] here, none [stuck] (the output's rate before), in turn. */
    fun ratesFor(count: Int, taken: List<Int>, stuck: Int): List<Int> {
        val pool = TRY_AT.filter { it in taken && it != stuck }.ifEmpty { listOf(96000) }
        return List(count) { pool[it % pool.size] }
    }

    /** The way to play by: the first float way the output followed; null where none did. */
    fun chosen(tried: List<Tried>): Way? = tried.firstOrNull { it.way.float && it.followed }?.way

    /** [w] tried at [rate]: a fifth of a second of silence, the output's rate read as it plays. */
    fun attempt(w: Way, rate: Int): Tried {
        val enc = if (w.float) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT
        val min = runCatching { AudioTrack.getMinBufferSize(rate, STEREO, enc) }.getOrDefault(-1)
        if (min <= 0) return Tried(w, rate, 0, "rate not taken")
        val t = try { w.make(rate, min * 2, 0) } catch (e: Exception) { return Tried(w, rate, 0, e.message ?: e.javaClass.simpleName) }
        return try {
            if (t.state != AudioTrack.STATE_INITIALIZED) return Tried(w, rate, 0, "not made")
            t.play()
            val n = rate / 5 * 2
            val before = said()
            if (w.float) t.write(FloatArray(n), 0, n, AudioTrack.WRITE_BLOCKING) else t.write(ShortArray(n), 0, n)
            Tried(w, rate, OwnDac.outputRate(), null, saidRate(newer(said(), before), rate))
        } catch (e: Exception) {
            Tried(w, rate, 0, e.message ?: e.javaClass.simpleName)
        } finally { runCatching { t.stop() }; t.release() }
    }

    /** Every way tried in turn, a moment between them for the output to settle. Never while a track plays. */
    fun tryAll(taken: List<Int>): List<Tried> {
        val rates = ratesFor(WAYS.size, taken, OwnDac.outputRate())
        return WAYS.mapIndexed { i, w -> attempt(w, rates[i]).also { Thread.sleep(300) } }
    }

    /**
     * The rate FiiO's own audio code says a track at [rate] went out at (its AudioTrack log in this app's own logcat:
     * "config_audio_params:mSampleRate=176400 … check AudioFlinger sampleRate=44100"), the last it said; 0 unsaid.
     */
    fun saidRate(lines: List<String>, rate: Int): Int {
        val re = Regex("config_audio_params:mSampleRate=(\\d+).*check AudioFlinger sampleRate=(\\d+)")
        return lines.mapNotNull { re.find(it) }.lastOrNull { it.groupValues[1].toIntOrNull() == rate }?.groupValues?.get(2)?.toIntOrNull() ?: 0
    }

    /** The lines of [after] past the last of [before] (logcat's window moves on): all of them where it isn't there. */
    fun newer(after: List<String>, before: List<String>): List<String> {
        val last = before.lastOrNull() ?: return after
        val i = after.lastIndexOf(last)
        return if (i < 0) after else after.drop(i + 1)
    }

    /** This app's own AudioTrack lines of late (logcat, as BridgeLog reads its own); none where it can't be read. */
    fun said(): List<String> = runCatching {
        val p = ProcessBuilder("logcat", "-d", "-t", "300", "-v", "threadtime", "-s", "AudioTrack", "--pid=${android.os.Process.myPid()}")
            .redirectErrorStream(true).start()
        p.inputStream.bufferedReader().readLines().also { p.waitFor() }
    }.getOrDefault(emptyList())

    fun json(tried: List<Tried>): JSONArray = JSONArray().also { a -> tried.forEach { a.put(it.json()) } }

    /**
     * The tracks the player plays the device's own DAC with: by the way chosen ([OwnDac.way]) for a stereo float track,
     * else as media3 makes them.
     */
    @OptIn(UnstableApi::class)
    fun provider(): DefaultAudioSink.AudioTrackProvider = object : DefaultAudioSink.AudioTrackProvider {
        override fun getAudioTrack(config: AudioSink.AudioTrackConfig, audioAttributes: androidx.media3.common.AudioAttributes,
                                   audioSessionId: Int, context: Context?): AudioTrack {
            val w = OwnDac.way
            if (w == null || !w.float || config.encoding != C.ENCODING_PCM_FLOAT || config.channelConfig != STEREO || config.tunneling || config.offload)
                return DefaultAudioSink.AudioTrackProvider.DEFAULT.getAudioTrack(config, audioAttributes, audioSessionId, context)
            return w.make(config.sampleRate, config.bufferSize, audioSessionId)
        }
    }
}
