// Update.cs — the Bridge updated from Mandarin's Settings → Updates (item 291). Asked with a release's tag (POST
// /update {tag}: "test-bridge" or "mandarin-bridge-v…", never an address: its port has no sign-in), it fetches that
// release of Mandarin's from GitHub itself, the tarball for this machine (mandarin-bridge-linux-<arch>.tar.gz) and its
// sidecar (.json: the build and its SHA-256), checks the one against the other, and unpacks it into its data folder
// (app/). Then it stops, and systemd starts it again: the program installed hands over to the one in app/ (Program.cs),
// and goes back to itself where that one fails as it starts. Every request says what it is (a User-Agent): GitHub
// refuses one that doesn't (item 327). A secure connection refused says why (item 359): this computer's clock wrong
// (a Raspberry Pi has no clock of its own, and GitHub's certificate isn't valid on a date years ago), its certificates
// missing or out of date, or the answer not GitHub's; before, it said only "SecureConnectionError". One that fails before
// any certificate is seen (item 385: a DietPi's, every time, where curl on the same computer fetched GitHub's releases)
// says what .NET said, and is fetched with curl instead: curl checks GitHub's certificate against this computer's own,
// and the download is checked against its checksum (and signature) as any other.
using System.Diagnostics;
using System.Net.Security;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Bridge;

internal sealed partial class Update(string api, string data, Action<string> log, Action restart, string curl = "curl")
{
    public const string Repo = "meltface-80/Mandarin";
    private static readonly HttpClient Http = Client();
    private readonly object gate = new();
    private string state = "idle", said = "", to = "";
    private bool viaCurl;   // this update's fetches made by curl, .NET having failed to connect securely

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
        // Never backwards (item 352): an older release may lack what a newer one fixed.
        if (Guard.Older(tag, Program.Version)) return (false, $"{tag} is older than this Bridge ({Program.Version})");
        lock (gate)
        {
            if (state is "downloading" or "installing" or "restarting") return (false, "an update is already under way");
            (state, said, to) = ("downloading", "Downloading the update", "");
        }
        _ = Task.Run(() => Go(tag));
        return (true, "");
    }

    private void Say(string s, string w) { lock (gate) (state, said) = (s, w); }

    // Why the last secure connection's certificate was refused, in words; null where it wasn't.
    private static volatile string? refused;

    // GitHub asked as Mandarin Bridge: a request with no User-Agent is refused (403). Its certificate checked as .NET
    // checks it, why it is refused kept to be said.
    private static HttpClient Client()
    {
        var handler = new SocketsHttpHandler
        {
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (_, _, chain, errors) => { refused = Refused(errors, chain, DateTime.Now); return errors == SslPolicyErrors.None; }
            }
        };
        var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("mandarin-bridge");
        return http;
    }

    /* Why a certificate with [errors] (its [chain] as built) is refused, in words, on this computer's date [now]; null
       where it isn't. */
    internal static string? Refused(SslPolicyErrors errors, X509Chain? chain, DateTime now)
    {
        if (errors == SslPolicyErrors.None) return null;
        var status = chain?.ChainStatus.Aggregate(X509ChainStatusFlags.NoError, (a, s) => a | s.Status) ?? X509ChainStatusFlags.NoError;
        if ((status & X509ChainStatusFlags.NotTimeValid) != 0)
            return $"GitHub's certificate isn't valid on this computer's date ({now:d MMMM yyyy, HH:mm}): its clock is wrong. Set it to sync the time (on DietPi, dietpi-config → Advanced Options → Time sync mode)";
        if ((errors & SslPolicyErrors.RemoteCertificateNameMismatch) != 0)
            return "the answer wasn't GitHub's (its certificate is another site's): something on the network answered in its place";
        if ((status & (X509ChainStatusFlags.UntrustedRoot | X509ChainStatusFlags.PartialChain)) != 0 || (errors & SslPolicyErrors.RemoteCertificateNotAvailable) != 0)
            return "this computer doesn't trust GitHub's certificate: its certificates are missing or out of date (sudo apt install --reinstall ca-certificates)";
        return "GitHub's certificate was refused (" + (status != X509ChainStatusFlags.NoError ? status.ToString() : errors.ToString()) + ")";
    }

    // Why [e] stopped the update, in words (this build has none of .NET's own: UseSystemResourceKeys).
    private static string Why(Exception e) => e switch
    {
        HttpRequestException { StatusCode: { } code } => $"GitHub answered {(int)code} ({code})",
        HttpRequestException { HttpRequestError: HttpRequestError.SecureConnectionError } when refused is { } why => why,
        HttpRequestException { HttpRequestError: HttpRequestError.SecureConnectionError } h => $"a secure connection to GitHub couldn't be made ({Cause(h)})",
        HttpRequestException h => "GitHub couldn't be reached" + (h.HttpRequestError is HttpRequestError.Unknown ? "" : $" ({h.HttpRequestError})"),
        TaskCanceledException => "GitHub took too long to answer",
        System.Text.Json.JsonException => "GitHub's answer wasn't the release",
        UnauthorizedAccessException => "its data folder can't be written to",
        HttpIOException => "the download broke off",
        IOException => "its data folder couldn't be written to",
        // A program that couldn't be started says which, and why (item 391): every one was "tar couldn't be run" before.
        System.ComponentModel.Win32Exception w => w.Message,
        _ => e.Message,
    };

    private async Task Go(string tag)
    {
        var tmp = Path.Combine(data, "app.new");
        refused = null;
        viaCurl = false;
        try
        {
            var rel = JsonNode.Parse(await Text($"{api.TrimEnd('/')}/repos/{Repo}/releases/tags/{tag}")) as JsonObject;
            var name = $"mandarin-bridge-{Arch}.tar.gz";
            string Url(string n) => (rel?["assets"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(a => (string?)a["name"] == n)?["browser_download_url"]?.ToString()
                ?? throw new InvalidOperationException($"the release {tag} has no {n}");
            var side = JsonNode.Parse(await Text(Url(name + ".json"))) as JsonObject;
            var sha = ((string?)side?["sha256"] ?? "").ToLowerInvariant();
            var build = (string?)side?["commit"] ?? "";
            if (sha.Length != 64) throw new InvalidOperationException("the release says no checksum for its build");
            lock (gate) to = build;
            if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
            Directory.CreateDirectory(tmp);
            var tgz = Path.Combine(tmp, name);
            await Save(Url(name), tgz);
            string got;
            await using (var f = File.OpenRead(tgz)) got = Convert.ToHexStringLower(await SHA256.HashDataAsync(f));
            if (got != sha) throw new InvalidOperationException("the download isn't the build the release says (its checksum differs)");
            Signed(side, tgz);
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

    // The download signed with Mandarin's release key, where one is built in (item 371): the sidecar's "sig", base64 of
    // the key's signature of the tarball. A checksum alone can be replaced with the tarball by whoever can write to the
    // release; a signature can't be made without the key, which isn't there.
    private static void Signed(JsonObject? side, string tgz)
    {
        if (ReleaseKey.Current is not { } key) return;
        var sig = (string?)side?["sig"] ?? throw new InvalidOperationException("the release's build isn't signed");
        byte[] der;
        try { der = Convert.FromBase64String(sig); } catch (FormatException) { throw new InvalidOperationException("the release's signature can't be read"); }
        if (!ReleaseKey.Verify(key, File.ReadAllBytes(tgz), der)) throw new InvalidOperationException("the download isn't signed with Mandarin's release key");
    }

    // [url]'s answer as text: by .NET, or by curl where .NET can't connect securely (item 385).
    private async Task<string> Text(string url)
    {
        if (!viaCurl)
            try { return await Http.GetStringAsync(url); }
            catch (HttpRequestException e) when (ByCurl(e)) { /* below */ }
        var file = Path.Combine(data, "fetched.json");
        try { Curl(url, file); return await File.ReadAllTextAsync(file); }
        finally { File.Delete(file); }
    }

    // [url] saved to [file], likewise.
    private async Task Save(string url, string file)
    {
        if (!viaCurl)
            try
            {
                await using var f = File.Create(file);
                await (await Http.GetStreamAsync(url)).CopyToAsync(f);
                return;
            }
            catch (HttpRequestException e) when (ByCurl(e)) { /* below */ }
        Curl(url, file);
    }

    // Whether [e] is a secure connection that failed before GitHub's certificate was seen (one refused says why, and is
    // never fetched around), with curl here to fetch it instead: what .NET said is logged, once an update.
    private bool ByCurl(HttpRequestException e)
    {
        if (e.HttpRequestError != HttpRequestError.SecureConnectionError || refused != null || !CurlHere()) return false;
        viaCurl = true;
        log($"update: couldn't make a secure connection to GitHub ({Cause(e)}); fetched with curl instead");
        return true;
    }

    private bool CurlHere() => curl.Contains('/') ? File.Exists(curl)
        : (Environment.GetEnvironmentVariable("PATH") ?? "").Split(':').Any(d => d.Length > 0 && File.Exists(Path.Combine(d, curl)));

    // As the install line fetches: GitHub's download service answers 502 now and then (item 380), so tried again.
    private void Curl(string url, string file) =>
        RunFor(TimeSpan.FromMinutes(10), curl, "-fsSL", "--retry", "3", "--connect-timeout", "20", "-A", "mandarin-bridge", "-o", file, url);

    /* What .NET said of [e], the innermost of it last: the reason a secure connection failed. */
    internal static string Cause(HttpRequestException e)
    {
        var said = new List<string>();
        for (var x = e.InnerException; x != null; x = x.InnerException)
            if (x.Message.Trim() is { Length: > 0 } m && $"{x.GetType().Name} {m}" is var one && !said.Contains(one)) said.Add(one);
        return said.Count > 0 ? string.Join(": ", said) : e.HttpRequestError.ToString();
    }

    /* The version the program at [path] says it is ("mandarin-bridge 0.3.5 (abc1234)"), or null where it says none. */
    public static string? VersionOf(string path)
    {
        try { return Run(path, "--version") is var v && v.StartsWith("mandarin-bridge ", StringComparison.Ordinal) ? v.Split(' ')[1].Trim() : null; }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { return null; }
    }

    // [file] run with [args], its output; it throws where it fails.
    private static string Run(string file, params string[] args) => RunFor(TimeSpan.FromSeconds(60), file, args);

    private static string RunFor(TimeSpan wait, string file, params string[] args)
    {
        var psi = new ProcessStartInfo(file) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        Process? started;
        try { started = Process.Start(psi); }
        catch (System.ComponentModel.Win32Exception e) { throw new System.ComponentModel.Win32Exception(e.NativeErrorCode, $"{Path.GetFileName(file)} couldn't be run ({e.Message})"); }
        using var p = started ?? throw new InvalidOperationException(file + " couldn't be run");
        var output = p.StandardOutput.ReadToEndAsync();
        var err = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(wait)) { p.Kill(); throw new InvalidOperationException(file + " didn't finish"); }
        if (p.ExitCode != 0) throw new InvalidOperationException($"{Path.GetFileName(file)} failed: {err.Result.Trim()}");
        return output.Result;
    }
}
