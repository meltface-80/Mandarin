// AudioEngine.cs — Mandarin's audio engine for sound devices on the server
// (engine/Mandarin.Audio), as lib/local/engine.js finds and fetches it
// (v0.8.49, stage 6 part 4): AUDIO_ENGINE_BIN, the image's
// (engine/bin/mandarin-audio beside the app), or the one downloaded into the
// data folder; the first that answers "<version> protocol 1". None with
// AUDIO_ENGINE=0, or off Linux (it plays through ALSA). One found is
// remembered; none is looked for again a minute on. Where the image lacks it
// (an install updated in place whose image predates the engine) it is fetched
// once, in the background, from the "audio-engine" pre-release on GitHub and
// checked against its SHA256SUMS; until it is here, a sound device can't be
// played from this server.
using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Local;

internal static partial class AudioEngine
{
    private const int Protocol = 1;
    private const string ReleaseUrl = "https://github.com/meltface-80/Mandarin/releases/download/audio-engine";
    private static readonly string? Arch = RuntimeInformation.ProcessArchitecture switch { Architecture.X64 => "x64", Architecture.Arm64 => "arm64", _ => null };
    private static readonly object Gate = new();
    private static Found? found;
    private static long lookedAt;
    private static Task<bool>? downloading;

    public sealed record Found(string Bin, string Version);

    public static string? Version() => Find()?.Version;

    private static bool Off => (Environment.GetEnvironmentVariable("AUDIO_ENGINE") ?? "").Trim() == "0" || !OperatingSystem.IsLinux();
    private static string DownloadedBin(string dataDir) => Path.Combine(dataDir, "bin", "mandarin-audio");

    /* The engine to use, or null. Decided once (and again after a download, or a minute on when there was none). */
    public static Found? Find(string? dataDir = null)
    {
        if (Off) return null;
        lock (Gate)
        {
            if (found != null) return found;
            if (Environment.TickCount64 - lookedAt < 60000 && lookedAt != 0) return null;
            lookedAt = Environment.TickCount64;
            var app = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir();
            var data = dataDir is { Length: > 0 } ? dataDir : Server.DataDir;
            var tries = new[] { Environment.GetEnvironmentVariable("AUDIO_ENGINE_BIN"), Path.Combine(app, "engine", "bin", "mandarin-audio"), data.Length > 0 ? DownloadedBin(data) : null };
            foreach (var b in tries)
                if (!string.IsNullOrEmpty(b) && Probe(b) is { } v) return found = new Found(b, v);
            return null;
        }
    }

    /* For a test: forget what was found. */
    public static void Reset() { lock (Gate) { found = null; lookedAt = 0; } }

    /* A location the engine can play: an ALSA device, or the tests' file. */
    public static bool Plays(string? location) => Regex.IsMatch(location ?? "", "^(alsa|file):");

    private static bool Executable(string f)
    {
        if (OperatingSystem.IsWindows()) return false;
        try { return File.Exists(f) && (File.GetUnixFileMode(f) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { return false; }
    }

    /* "0.8.0 protocol 1" from the program, or null if it isn't one that can be driven. */
    public static string? Probe(string bin)
    {
        if (!OperatingSystem.IsLinux() || !Executable(bin)) return null;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(bin, "--version") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var outText = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return null; }
            var m = Regex.Match(outText.Result, @"^(\S+) protocol ([0-9]+)");
            return m.Success && int.TryParse(m.Groups[2].Value, out var n) && n == Protocol ? m.Groups[1].Value : null;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException or InvalidOperationException) { return null; }
    }

    /*
     * At the hub's start (index.js): the engine said, or fetched once in the
     * background where the image lacks it and that is allowed (Docker, or asked
     * for: AUDIO_ENGINE_DOWNLOAD=1, AUDIO_ENGINE_URL).
     */
    public static void StartUp(string dataDir, string version, Action<string> log)
    {
        var e = Find(dataDir);
        if (e != null) { log($"[local] Mandarin's audio engine {e.Version} plays sound devices on this computer"); return; }
        static string? Env(string k) => Environment.GetEnvironmentVariable(k);
        var may = Env("DOCKER") == "1" || Env("AUDIO_ENGINE_DOWNLOAD") == "1" || !string.IsNullOrEmpty(Env("AUDIO_ENGINE_URL"));
        if (may) _ = Ensure(dataDir, version, log);
    }

    /* No engine in the image or the checkout: fetch the one for this version, once, in the background. */
    public static Task<bool> Ensure(string dataDir, string version, Action<string> log)
    {
        if (Find(dataDir) != null) return Task.FromResult(true);
        if (Off || Arch == null || dataDir.Length == 0) return Task.FromResult(false);
        var bin = DownloadedBin(dataDir);
        var marker = bin + ".version";
        string? have = null;
        try { have = File.ReadAllText(marker).Trim(); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* none yet */ }
        if (Executable(bin) && have == version) return Task.FromResult(Find(dataDir) != null);
        lock (Gate)
        {
            if (downloading != null) return downloading;
            downloading = Download(bin, marker, version, log).ContinueWith(t => { lock (Gate) downloading = null; return t.Result; });
            return downloading;
        }
    }

    private static async Task<bool> Download(string bin, string marker, string version, Action<string> log)
    {
        var name = $"mandarin-audio-linux-{Arch}.gz";
        try
        {
            var baseUrl = Regex.Replace(Environment.GetEnvironmentVariable("AUDIO_ENGINE_URL") is { Length: > 0 } u ? u : ReleaseUrl, "/+$", "");
            using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true }) { Timeout = TimeSpan.FromMinutes(5) };
            async Task<byte[]> Get(string url)
            {
                using var r = await http.GetAsync(url);
                if (!r.IsSuccessStatusCode) throw new HttpRequestException($"{url.Split('/')[^1]}: HTTP {(int)r.StatusCode}");
                return await r.Content.ReadAsByteArrayAsync();
            }
            log($"[local] downloading Mandarin's audio engine ({name})…");
            var sums = System.Text.Encoding.UTF8.GetString(await Get($"{baseUrl}/SHA256SUMS"));
            var want = sums.Split('\n').Select(l => Regex.Split(l.Trim(), @"\s+")).FirstOrDefault(p => p.Length > 1 && p[1] == name)?[0]
                ?? throw new HttpRequestException($"no checksum for {name}");
            var gz = await Get($"{baseUrl}/{name}");
            if (!string.Equals(Convert.ToHexString(SHA256.HashData(gz)), want, StringComparison.OrdinalIgnoreCase)) throw new HttpRequestException("the download was damaged (checksum mismatch)");
            Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
            // A name of this server's own, so a Node server fetching it at the same time never writes the same file.
            var tmp = bin + ".csharp.tmp";
            using (var src = new GZipStream(new MemoryStream(gz), CompressionMode.Decompress))
            using (var dst = File.Create(tmp)) await src.CopyToAsync(dst);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(tmp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            File.Move(tmp, bin, true);
            File.WriteAllText(marker, version);
            Reset();   // look again
            var e = Find(Path.GetDirectoryName(Path.GetDirectoryName(bin))!);
            log(e != null ? $"[local] audio engine {e.Version} ready" : "[local] the downloaded audio engine doesn't run here; devices can't be played from this server");
            return e != null;
        }
        catch (Exception e) when (e is HttpRequestException or IOException or UnauthorizedAccessException or TaskCanceledException or InvalidDataException)
        {
            log($"[local] couldn't download the audio engine ({e.Message}); sound devices on this computer can't be played until it is here");
            return false;
        }
    }
}
