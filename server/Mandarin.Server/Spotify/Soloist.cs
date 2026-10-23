// Soloist.cs — Spotify Lossless, through Spotify Soloist (bug list item 142; docs/spotify-plan.md). Mandarin as a
// Spotify Connect device, "Mandarin" in the Spotify app's devices, playing what Spotify plays into the room chosen
// for it. Ported from Mandarin DAC Bridge's SoloistPlayer.cs, where a DAC is the speaker; here the speaker is a room.
//
//   Soloist ──libpulse──▶ private PulseAudio ──pipe sink, S32 LE 44.1 kHz──▶ here ──▶ /stream/spotify/live (FLAC) ──▶ the room
//   Soloist ──WebSocket (127.0.0.1)──▶ here: signed in, active, playing / paused / idle, the track, its position, the volume
//
// Soloist plays to PipeWire or PulseAudio, never to a file or a pipe of its own. So it is started with a private
// PulseAudio of its own, with no sound card in it, only a pipe sink (Soloist.Sound.cs): what it plays comes out of a
// named pipe as 32-bit samples at 44.1 kHz, Spotify's 16- and 24-bit audio carried exactly. Its WebSocket
// (Soloist.Socket.cs) says what plays; Spotify.cs plays the live stream in the room when Spotify starts, and sends
// Now Playing's controls back.
//
// Each user brings their own Soloist API key, and Soloist itself, which may not be redistributed: Mandarin
// downloads it from Spotify (SoloistDownload.cs). The key goes to Soloist on its command line, and is taken out of
// everything Soloist says before it is kept or shown.
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;

namespace Mandarin.Server.Spotify;

/* What Soloist is started with: the program, PulseAudio, the key, and the name the Spotify app shows. */
internal sealed record SoloistSetup(string Soloist, string PulseAudio, string ApiKey, string DeviceName, string Quality = "lossless");

/* What plays, as Soloist says it. Position is seconds at [At] (Unix ms); 0 duration when unknown. */
internal sealed record SoloistTrack(string Title, string Artists, string Album, string Cover, double Duration, double Position = 0, long At = 0, string Uri = "");

internal sealed partial class Soloist : IDisposable
{
    public const int Rate = 44100;
    private const int FrameBytes = 8;      // 2 channels of S32
    private const int ExitExpired = 10;    // Soloist: this build is past its 90 days

    private sealed class NotReady(string message) : Exception(message);

    private readonly Func<SoloistSetup> setup;
    private readonly Action<string> log;
    private readonly string dataDir, cacheDir;
    private string runDir = "", fifo = "", socket = "";   // made afresh for each run of Soloist
    private volatile string key = "";
    private readonly CancellationTokenSource stop = new();
    private readonly object gate = new();
    private readonly SemaphoreSlim sendGate = new(1, 1);
    private readonly Thread runner;
    private Process? pulse, soloist;
    private ClientWebSocket? ws;
    private string lastError = "", soloistError = "";
    private readonly object logGate = new();

    /* "starting", "ready · choose it in Spotify", "playing", … or what's wrong. */
    public string Status { get; private set; } = "starting";
    public bool SignedIn { get; private set; }
    public bool Active { get; private set; }
    /* "playing", "paused" or "idle", as Soloist last said. */
    public string Playback { get; private set; } = "idle";
    public SoloistTrack Track { get; private set; } = new("", "", "", "", 0);
    public int Volume { get; private set; } = 100;

    /* Anything above changed (on Soloist's threads: keep it short). */
    public event Action? Changed;
    /* This build is past its date: download it again. */
    public event Action? Expired;

    public Soloist(string dataRoot, Func<SoloistSetup> setup, Action<string> log)
    {
        this.setup = setup;
        this.log = log;
        dataDir = Path.Combine(dataRoot, "spotify", "data");
        cacheDir = Path.Combine(dataRoot, "spotify", "cache");
        runner = new Thread(Run) { IsBackground = true, Name = "soloist" };
        runner.Start();
    }

    private void Log(string m) => log("[spotify] " + Clean(m, key));

    private void SetStatus(string s)
    {
        s = Clean(s, key);
        if (s == Status) return;
        Status = s;
        Changed?.Invoke();
    }

    private void Wait(int ms) => stop.Token.WaitHandle.WaitOne(ms);

    // ------------------------------------------------------------ Soloist and its sound server

    private void Run()
    {
        int quick = 0;
        while (!stop.IsCancellationRequested)
        {
            var started = Environment.TickCount64;
            bool notReady = false;
            try { RunOnce(); }
            catch (Exception e)
            {
                if (stop.IsCancellationRequested) return;   // switched off: stopping on purpose
                notReady = e is NotReady;
                var why = e is AggregateException a ? a.InnerException?.Message ?? a.Message : e.Message;
                if (why != lastError) Log(why);
                lastError = why;
                SetStatus(why);
            }
            finally { Teardown(); }
            if (stop.IsCancellationRequested) return;
            // Something missing (a key, Soloist, PulseAudio): look again soon. A crash: back off.
            quick = notReady ? 0 : Environment.TickCount64 - started < 30_000 ? quick + 1 : 0;
            Wait(notReady ? 5000 : Math.Min(60_000, 2000 * (1 << Math.Min(quick, 5))));
        }
    }

    private void RunOnce()
    {
        var s = setup();
        if (!OperatingSystem.IsLinux()) throw new NotReady("Spotify Soloist runs on Linux only");
        if (s.ApiKey == "") throw new NotReady("needs your Soloist API key");
        if (s.Soloist == "" || !File.Exists(s.Soloist)) throw new NotReady("needs Spotify Soloist: Download it here");
        if (s.PulseAudio == "") throw new NotReady("needs PulseAudio for Soloist's sound (it is in Mandarin's Docker image)");

        key = s.ApiKey;
        // Its folders hold its Spotify sign-in and its log: Mandarin's only.
        foreach (var dir in new[] { Path.GetDirectoryName(dataDir)!, dataDir, cacheDir })
        {
            Directory.CreateDirectory(dir, OwnerOnly);
            try { File.SetUnixFileMode(dir, OwnerOnly); }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException) { /* no Unix modes there */ }
        }
        // Its sound (a socket any local program could play into, a pipe Mandarin reads) in a folder made new for
        // this run, with a name no one can guess. Short: a unix socket's path has to fit in 108 bytes.
        runDir = Directory.CreateTempSubdirectory("mandarin-soloist-").FullName;
        fifo = Path.Combine(runDir, "sound");
        socket = Path.Combine(runDir, "pulse", "native");
        Directory.CreateDirectory(Path.GetDirectoryName(socket)!, OwnerOnly);
        if (!Libc.MakeFifo(fifo)) throw new IOException("couldn't make the pipe " + fifo);

        // Lossless asked for on the accounts already signed in, before Soloist reads their prefs.
        Quality = s.Quality;
        try { AskQuality(dataDir, Quality); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Log("couldn't ask for lossless: " + e.Message); }
        askedAfterSignIn = false;
        Proof.Reset();
        StartPulse(s.PulseAudio);
        StartReader();
        StartSoloist(s);
        Listen();

        var p = soloist;
        if (p != null && p.WaitForExit(3000))
        {
            if (p.ExitCode == ExitExpired)
            {
                Expired?.Invoke();
                throw new NotReady("this Soloist build has expired (Spotify's builds last 90 days): Download it again");
            }
            if (soloistError.StartsWith("Soloist needs", StringComparison.Ordinal)) throw new NotReady(soloistError);
            throw new InvalidOperationException($"Soloist stopped ({p.ExitCode}){(soloistError != "" ? ": " + soloistError : "")}");
        }
        throw new InvalidOperationException("Soloist's WebSocket closed");
    }

    private void StartSoloist(SoloistSetup s)
    {
        foreach (var f in new[] { "ws.port", "ws.addr" }) File.Delete(Path.Combine(dataDir, f));
        var psi = new ProcessStartInfo(s.Soloist) { RedirectStandardError = true, RedirectStandardOutput = true, UseShellExecute = false };
        // Its volume starts at 100% and stays there (Soloist.Socket.cs): bit-perfect; the room has its own.
        foreach (var a in new[] { "--device-name", s.DeviceName, "--api-key", s.ApiKey, "--data-dir", dataDir, "--cache-dir", cacheDir, "--initial-volume", "100", "--ws", "127.0.0.1:0" })
            psi.ArgumentList.Add(a);
        if (Environment.GetEnvironmentVariable("SOLOIST_VERBOSE") == "1") psi.ArgumentList.Add("--verbose");
        foreach (var (k, v) in PrivateEnvironment()) psi.Environment[k] = v;
        soloistError = "";
        Process p;
        try { p = Process.Start(psi) ?? throw new InvalidOperationException("Soloist didn't start"); }
        catch (System.ComponentModel.Win32Exception e) { throw new NotReady($"can't run {s.Soloist}: {e.Message}"); }
        void Line(string? l)
        {
            if (l == null) return;
            l = Clean(l, key);
            Keep(l);
            if (l.Contains("GLIBC_", StringComparison.Ordinal) || l.Contains("error while loading shared libraries", StringComparison.Ordinal)) soloistError = SoloistDownload.Explain(l);
            else if (l.Contains("rror", StringComparison.Ordinal) || l.Contains("WARN", StringComparison.Ordinal) || l.Contains("arning", StringComparison.Ordinal)) soloistError = l.Length > 200 ? l[..200] : l;
            else return;
            Log(l.Length > 200 ? l[..200] : l);
        }
        p.ErrorDataReceived += (_, e) => Line(e.Data);
        p.OutputDataReceived += (_, e) => Line(e.Data);
        p.BeginErrorReadLine();
        p.BeginOutputReadLine();
        lock (gate) soloist = p;
        Log($"offering {s.DeviceName} to Spotify (Soloist)");
    }

    // All of Soloist's own output, in DATA_DIR/spotify/soloist.log (Mandarin's only; up to 2 MB, then the old one is
    // kept as soloist.log.1). It can name the account: don't post it publicly. The key is never in it.
    private string LogFile => Path.Combine(Path.GetDirectoryName(dataDir)!, "soloist.log");

    private const UnixFileMode OwnerOnly = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;

    private void Keep(string line)
    {
        if (OperatingSystem.IsWindows()) return;   // the log's owner-only mode is Unix's (and Soloist never runs there)
        line = Clean(line, key);
        lock (logGate)
        {
            try
            {
                var f = LogFile;
                var info = new FileInfo(f);
                if (info.Exists && info.Length > 2_000_000) File.Move(f, f + ".1", overwrite: true);
                using var file = new FileStream(f, new FileStreamOptions
                {
                    Mode = FileMode.Append, Access = FileAccess.Write, Share = FileShare.ReadWrite,
                    UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
                });
                file.Write(Encoding.UTF8.GetBytes($"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {line}\n"));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* a log, at best: Soloist runs on */ }
        }
    }

    /* Anything Soloist says, with the key it was given taken out, wherever it goes. */
    internal static string Clean(string line, string key) => key.Length >= 4 ? line.Replace(key, "[key]", StringComparison.Ordinal) : line;

    private void Teardown()
    {
        StopReader();
        Process? s, p;
        ClientWebSocket? w;
        lock (gate) { s = soloist; p = pulse; w = ws; soloist = null; pulse = null; ws = null; }
        foreach (var x in new[] { s, p })
        {
            if (x == null) continue;
            try { if (!x.HasExited) x.Kill(entireProcessTree: true); x.WaitForExit(2000); }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ }
            x.Dispose();
        }
        try { w?.Abort(); w?.Dispose(); } catch (ObjectDisposedException) { /* closing */ }
        if (runDir != "")
            try { Directory.Delete(runDir, recursive: true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* the next run makes a new one */ }
        runDir = "";
        lock (gate) { SignedIn = false; Active = false; Playback = "idle"; }
        Changed?.Invoke();
    }

    public void Dispose()
    {
        stop.Cancel();
        runner.Join(TimeSpan.FromSeconds(8));
        stop.Dispose();
        sendGate.Dispose();
    }
}
