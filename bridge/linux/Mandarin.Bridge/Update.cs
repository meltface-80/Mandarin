// Update.cs — the Bridge updated from Mandarin's Settings → Updates (item 291). Asked with a release's tag (POST
// /update {tag}: "test-bridge" or "mandarin-bridge-v…", never an address: its port has no sign-in), it fetches that
// release of Mandarin's from GitHub itself, the tarball for this machine (mandarin-bridge-linux-<arch>.tar.gz) and its
// sidecar (.json: the build and its SHA-256), checks the one against the other, and unpacks it into its data folder
// (app/). Then it stops, and systemd starts it again: the program installed hands over to the one in app/ (Program.cs),
// and goes back to itself where that one fails as it starts. Every request says what it is (a User-Agent): GitHub
// refuses one that doesn't (item 327).
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Bridge;

internal sealed partial class Update(string api, string data, Action<string> log, Action restart)
{
    public const string Repo = "meltface-80/Mandarin";
    private static readonly HttpClient Http = Client();
    private readonly object gate = new();
    private string state = "idle", said = "", to = "";

    [GeneratedRegex(@"^(test-bridge|mandarin-bridge-v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?)$")]
    private static partial Regex Tag();

    /* This machine's build's name ("linux-x64", "linux-arm64"). */
    public static string Arch => "linux-" + (RuntimeInformation.OSArchitecture == Architecture.Arm64 ? "arm64" : "x64");

    /* Where an update is put: the newer program, beside its engine. */
    public static string AppDir(string data) => Path.Combine(data, "app");

    /* Where it is: idle, downloading, installing, restarting, failed; what it says; the build it goes to. */
    public JsonObject State()
    {
        lock (gate) return new JsonObject { ["state"] = state, ["says"] = said, ["to"] = to.Length > 0 ? to : null };
    }

    /* The release [tag] fetched and put in place, in the background; false, and why not, where it can't begin. */
    public (bool Ok, string Why) Start(string tag)
    {
        if (!Tag().IsMatch(tag)) return (false, "not a release of Mandarin Bridge's: " + tag);
        lock (gate)
        {
            if (state is "downloading" or "installing" or "restarting") return (false, "an update is already under way");
            (state, said, to) = ("downloading", "Downloading the update", "");
        }
        _ = Task.Run(() => Go(tag));
        return (true, "");
    }

    private void Say(string s, string w) { lock (gate) (state, said) = (s, w); }

    // GitHub asked as Mandarin Bridge: a request with no User-Agent is refused (403).
    private static HttpClient Client()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("mandarin-bridge");
        return http;
    }

    // Why [e] stopped the update, in words (this build has none of .NET's own: UseSystemResourceKeys).
    private static string Why(Exception e) => e switch
    {
        HttpRequestException { StatusCode: { } code } => $"GitHub answered {(int)code} ({code})",
        HttpRequestException h => "GitHub couldn't be reached" + (h.HttpRequestError is HttpRequestError.Unknown ? "" : $" ({h.HttpRequestError})"),
        TaskCanceledException => "GitHub took too long to answer",
        System.Text.Json.JsonException => "GitHub's answer wasn't the release",
        UnauthorizedAccessException => "its data folder can't be written to",
        HttpIOException => "the download broke off",
        IOException => "its data folder couldn't be written to",
        System.ComponentModel.Win32Exception => "tar couldn't be run",
        _ => e.Message,
    };

    private async Task Go(string tag)
    {
        var tmp = Path.Combine(data, "app.new");
        try
        {
            var rel = JsonNode.Parse(await Http.GetStringAsync($"{api.TrimEnd('/')}/repos/{Repo}/releases/tags/{tag}")) as JsonObject;
            var name = $"mandarin-bridge-{Arch}.tar.gz";
            string Url(string n) => (rel?["assets"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(a => (string?)a["name"] == n)?["browser_download_url"]?.ToString()
                ?? throw new InvalidOperationException($"the release {tag} has no {n}");
            var side = JsonNode.Parse(await Http.GetStringAsync(Url(name + ".json"))) as JsonObject;
            var sha = ((string?)side?["sha256"] ?? "").ToLowerInvariant();
            var build = (string?)side?["commit"] ?? "";
            if (sha.Length != 64) throw new InvalidOperationException("the release says no checksum for its build");
            lock (gate) to = build;
            if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
            Directory.CreateDirectory(tmp);
            var tgz = Path.Combine(tmp, name);
            await using (var f = File.Create(tgz)) await (await Http.GetStreamAsync(Url(name))).CopyToAsync(f);
            string got;
            await using (var f = File.OpenRead(tgz)) got = Convert.ToHexStringLower(await SHA256.HashDataAsync(f));
            if (got != sha) throw new InvalidOperationException("the download isn't the build the release says (its checksum differs)");
            Say("installing", "Installing the update");
            Run("tar", "-xzf", tgz, "-C", tmp);
            var unpacked = Path.Combine(tmp, "mandarin-bridge");
            foreach (var p in new[] { "mandarin-bridge", "mandarin-audio" })
                if (!File.Exists(Path.Combine(unpacked, p))) throw new InvalidOperationException("the update has no " + p);
            // The new program answers as itself before it is put in place.
            if (!Run(Path.Combine(unpacked, "mandarin-bridge"), "--version").StartsWith("mandarin-bridge ", StringComparison.Ordinal))
                throw new InvalidOperationException("the update's program doesn't run here");
            var app = AppDir(data);
            if (Directory.Exists(app)) Directory.Delete(app, true);
            Directory.Move(unpacked, app);
            Directory.Delete(tmp, true);
            Say("restarting", "Restarting into the update");
            log($"update: {build} put in place; restarting into it");
            restart();
        }
        catch (Exception e) when (e is HttpRequestException or IOException or InvalidOperationException or UnauthorizedAccessException
            or TaskCanceledException or System.Text.Json.JsonException or System.ComponentModel.Win32Exception)
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch (IOException) { /* left for the next */ }
            Say("failed", "The update couldn't be installed: " + Why(e));
            log("update failed: " + Why(e));
        }
    }

    // [file] run with [args], its output; it throws where it fails.
    private static string Run(string file, params string[] args)
    {
        var psi = new ProcessStartInfo(file) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException(file + " couldn't be run");
        var output = p.StandardOutput.ReadToEndAsync();
        var err = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(60_000)) { p.Kill(); throw new InvalidOperationException(file + " didn't finish"); }
        if (p.ExitCode != 0) throw new InvalidOperationException($"{Path.GetFileName(file)} failed: {err.Result.Trim()}");
        return output.Result;
    }
}
