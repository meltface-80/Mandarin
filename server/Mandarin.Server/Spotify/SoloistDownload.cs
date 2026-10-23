// SoloistDownload.cs — Spotify Soloist, fetched from Spotify (bug list item 142; as Mandarin DAC Bridge's
// SoloistDownload.cs, and spotifast-lossless's install.rs).
//
// Soloist may not be redistributed, so the image doesn't carry it: Settings → Services → Spotify's Download (and
// the supervisor, Soloist.cs, when a build nears its end) fetches the official archive for this machine's
// processor from Spotify's CDN and keeps the soloist program in DATA_DIR/spotify/soloist. A build lasts 90 days
// from its date (which `soloist --version` says): one with less than RefreshDays left is replaced by a newer
// one, and one past its date is replaced before Soloist starts.
using System.Diagnostics;
using System.Formats.Tar;
using System.Globalization;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Spotify;

internal static partial class SoloistDownload
{
    /* Replaced once it has fewer days left than this (spotifast replaces at 60 days of 90). */
    public const int RefreshDays = 30;

    /* Spotify's name for this processor's build, or null (Soloist isn't made for it). */
    public static string? Arch => RuntimeInformation.ProcessArchitecture switch
    {
        Architecture.X64 => "x86_64",
        Architecture.Arm64 => "arm64",
        Architecture.Arm => "arm32",
        _ => null
    };

    public static string Url(string arch) => $"https://soloist-builds.spotifycdn.com/soloist_release_{arch}.tar.gz";

    /* Where the program is kept: DATA_DIR/spotify/soloist. */
    public static string Program(string dataDir) => Path.Combine(dataDir, "spotify", "soloist", "soloist");

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };

    /* Downloads and unpacks the soloist program into [dir]; returns its path. [url] stands in for the CDN in the tests. */
    public static async Task<string> Fetch(string dir, CancellationToken ct, string? url = null)
    {
        var arch = Arch ?? throw new PlatformNotSupportedException($"Spotify makes no Soloist for {RuntimeInformation.ProcessArchitecture}");
        Directory.CreateDirectory(dir);
        var target = Path.Combine(dir, "soloist");
        var tmp = target + ".new";
        var archive = target + ".tar.gz";
        try
        {
            using (var r = await Http.GetAsync(url ?? Url(arch), HttpCompletionOption.ResponseHeadersRead, ct))
            {
                r.EnsureSuccessStatusCode();
                await using var to = File.Create(archive);
                await r.Content.CopyToAsync(to, ct);
            }
            await using var gz = new GZipStream(File.OpenRead(archive), CompressionMode.Decompress);
            using var tar = new TarReader(gz);
            bool found = false;
            while (await tar.GetNextEntryAsync(cancellationToken: ct) is { } e)
            {
                if (e.EntryType is not (TarEntryType.RegularFile or TarEntryType.V7RegularFile)) continue;
                var name = Path.GetFileName(e.Name);
                if (name == "soloist") { await e.ExtractToFileAsync(tmp, overwrite: true, ct); found = true; }
                else if (name is "CHANGELOG.md" or "THIRD_PARTY_LICENSES.txt") await e.ExtractToFileAsync(Path.Combine(dir, name), overwrite: true, ct);
            }
            if (!found) throw new InvalidDataException("Spotify's archive has no soloist program in it");
        }
        catch (Exception)
        {
            try { File.Delete(tmp); } catch (Exception) { /* none made, or held: the next download overwrites it */ }
            throw;
        }
        finally
        {
            try { File.Delete(archive); } catch (Exception) { /* held: the next download overwrites it */ }
        }
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(tmp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                                      | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        File.Move(tmp, target, overwrite: true);
        lock (Versions) Versions.Remove(target);
        return target;
    }

    /* The loader's complaint, said plainly ("" when there's none). */
    public static string Explain(string line)
    {
        if (line.Contains("GLIBC_", StringComparison.Ordinal)) return "Soloist needs a newer Linux (glibc 2.38 or later, e.g. Debian 13): use Mandarin's Docker image";
        var m = MissingLibrary().Match(line);
        if (!m.Success) return line;
        var lib = m.Groups[1].Value;
        var package = lib.StartsWith("libatomic", StringComparison.Ordinal) ? "libatomic1" : lib.Split(".so")[0];
        return $"Soloist needs {lib}: apt install {package}";
    }

    [GeneratedRegex(@"error while loading shared libraries: ([^:\s]+)")] private static partial Regex MissingLibrary();
    [GeneratedRegex(@"\((\d{4})(\d{2})(\d{2})\)")] private static partial Regex BuildDate();

    /* A build lasts 90 days from its date: "soloist 1.3.9.7 build … (20261010) …" → 8 January 2027; null when unsaid. */
    public static DateOnly? Expires(string version)
    {
        var m = BuildDate().Match(version);
        if (!m.Success) return null;
        try
        {
            return new DateOnly(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture),
                int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture)).AddDays(90);
        }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    /* What to do with the program on disk on [today]: "download" (none, or past its date), "refresh" (a newer one wanted), "use". */
    public static string Plan(bool exists, DateOnly? expires, DateOnly today) =>
        !exists || expires is { } e && e <= today ? "download"
        : expires is { } f && f.DayNumber - today.DayNumber < RefreshDays ? "refresh"
        : "use";

    private static readonly Dictionary<string, (DateTime Stamp, string Version)> Versions = [];

    /* "soloist 1.3.9 …" as the program says it (kept until the file changes); "" when it won't say. */
    public static string Version(string path)
    {
        if (path == "" || !File.Exists(path)) return "";
        var stamp = File.GetLastWriteTimeUtc(path);
        lock (Versions) if (Versions.TryGetValue(path, out var v) && v.Stamp == stamp) return v.Version;
        var text = "";
        try
        {
            using var p = Process.Start(new ProcessStartInfo(path, "--version") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false });
            if (p != null)
            {
                var read = p.StandardOutput.ReadToEndAsync();
                var err = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(3000)) p.Kill();
                text = (read.Result + "\n" + err.Result).Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l != "") ?? "";
                text = Explain(text);
            }
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or IOException) { text = ""; }
        if (text.Length > 120) text = text[..120];
        lock (Versions) Versions[path] = (stamp, text);
        return text;
    }
}
