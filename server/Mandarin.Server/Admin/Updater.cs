// Updater.cs — the in-app update, made here in the Node server's place
// (v0.8.48, stage 5 part 4 of docs/specs/csharp-migration.md): lib/updater.js,
// and the part of lib/server/csharp-update.js an update calls first (prepare),
// rule for rule.
//
// GitHub is asked for the latest release (or, with none published, the highest
// version among the tags), its version compared with this one's, and on
// request the release's bundle downloaded, unpacked with the system's tar,
// checked (index.js, package.json, the package's name), then — before anything
// is staged — this program of the new version fetched for this machine,
// checked against the release's SHA-256 sums and asked its version, and put in
// place of the running one (which carries on from the old file). Then the
// bundle is staged for launcher.js (.update/READY) and the Node server asked
// to start again (code 75): the launcher lays the new files in and starts a
// new Node server, which finds this program of another version and asks it to
// start again from the new file (code 76, Front.cs). With no launcher (the
// tests' own Node server) the files are laid in here, as applyStaged does.
//
// The check by itself: half a minute after the work is taken over, then every
// twelve hours (UPDATE_CHECK=false: never). Handed over as the job "update"
// (Jobs.cs); until then the Node server's own updater answers.
//
//   UPDATE_REPO    owner/repo (meltface-80/Mandarin); UPDATE_API where GitHub
//                  is asked (the tests' stand-in); both also said in the hand-over
//   GITHUB_TOKEN   sent to api.github.com alone, never to a host a redirect names
//   MANDARIN_SERVER_UPDATE=0   this program left as it is by an update
using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Updater
{
    private const string PackageName = "musicd-server";
    private const string Sums = "mandarin-server.sha256";
    private static readonly string[] Busy = ["downloading", "extracting", "preparing", "restarting"];
    private static readonly string[] Skip = [".git", ".github", "node_modules", ".update", "data", "android", "dist", "docs", "test"];

    private readonly string owner, repo, api, dir, current;
    private readonly string? token;
    private readonly bool viaLauncher, debug;
    private readonly Action<string> log;

    private readonly object gate = new();
    // lib/updater.js's state, field for field.
    private object? latest, latestTag, htmlUrl, notes, source, downloadUrl, error;
    private bool available, checking;
    private double checkedAt;
    private string phase = "idle";
    private object? applyError, applyVersion;
    private Task? check;
    private Timer? timer;

    private static readonly HttpClient Web = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30)
    }) { Timeout = Timeout.InfiniteTimeSpan };

    /* [cfg]: the hand-over's settings (index.js /internal/front/runs): where GitHub is asked, under the launcher or not. */
    public Updater(JsonObject cfg, string appDir, string version, Action<string> log)
    {
        static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
        var repoSpec = Text(cfg["update_repo"]) ?? Env("UPDATE_REPO") ?? "meltface-80/Mandarin";
        var slash = repoSpec.IndexOf('/');
        owner = slash < 0 ? repoSpec : repoSpec[..slash];
        repo = slash < 0 ? "" : repoSpec[(slash + 1)..];
        api = Text(cfg["update_api"]) ?? Env("UPDATE_API") ?? "https://api.github.com";
        viaLauncher = cfg["via_launcher"] is JsonValue vl && vl.TryGetValue<bool>(out var b) && b;
        token = Env("GITHUB_TOKEN");
        debug = Env("DEBUG") != null;
        dir = appDir;
        current = version;
        this.log = log;
        Checks = cfg["update_check"] is not JsonValue uc || !uc.TryGetValue<bool>(out var on) || on;
    }

    /* Whether to check by itself (UPDATE_CHECK, as the Node server read it). */
    public bool Checks { get; }

    private static string? Env(string name) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } v ? v : null;
    private void Debug(string s) { if (debug) log("[updater] " + s); }
    private static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ---------------------------------------------------------------- versions

    /* parseVer: major.minor.patch, a prerelease after - or +; null for anything else. */
    [GeneratedRegex(@"^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$")]
    private static partial Regex VersionShape();
    internal sealed record Ver(long Major, long Minor, long Patch, string? Pre);
    internal static Ver? ParseVer(object? tag)
    {
        if (Js.IsNullish(tag)) return null;
        var t = Js.Trim(Js.Str(tag));
        if (t.StartsWith('v') || t.StartsWith('V')) t = t[1..];
        var m = VersionShape().Match(t);
        if (!m.Success) return null;
        return new Ver(long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture),
            long.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture), m.Groups[4].Success && m.Groups[4].Value.Length > 0 ? m.Groups[4].Value : null);
    }
    public static int CmpVer(object? a, object? b)
    {
        var pa = ParseVer(a); var pb = ParseVer(b);
        if (pa == null || pb == null) return 0;
        if (pa.Major != pb.Major) return pa.Major > pb.Major ? 1 : -1;
        if (pa.Minor != pb.Minor) return pa.Minor > pb.Minor ? 1 : -1;
        if (pa.Patch != pb.Patch) return pa.Patch > pb.Patch ? 1 : -1;
        if (pa.Pre != null && pb.Pre == null) return -1;   // 1.2.0-beta < 1.2.0
        if (pa.Pre == null && pb.Pre != null) return 1;
        if (pa.Pre != null && pb.Pre != null) return CmpPre(pa.Pre, pb.Pre);
        return 0;
    }
    [GeneratedRegex(@"\d+|\D+")] private static partial Regex Runs();
    // "RC2" before "RC10": runs of digits compared as numbers, the rest as text.
    private static int CmpPre(string a, string b)
    {
        var x = Runs().Matches(a.ToLowerInvariant()).Select(m => m.Value).ToList();
        var y = Runs().Matches(b.ToLowerInvariant()).Select(m => m.Value).ToList();
        for (int i = 0; i < Math.Max(x.Count, y.Count); i++)
        {
            if (i >= x.Count) return -1;
            if (i >= y.Count) return 1;
            bool nx = x[i].All(char.IsAsciiDigit), ny = y[i].All(char.IsAsciiDigit);
            var d = nx && ny ? Js.StringToNumber(x[i]) - Js.StringToNumber(y[i]) : string.CompareOrdinal(x[i], y[i]);
            if (d != 0) return d > 0 ? 1 : -1;
        }
        return 0;
    }

    // ------------------------------------------------------------------ GitHub

    private sealed record Got(int Status, object? Json, string? Raw);

    /*
     * ghGetJson: a GET of GitHub's API, as JSON; redirects followed (a renamed
     * repository answers the old address with 301), six at most; the token to
     * api.github.com alone. Fifteen seconds.
     */
    private async Task<Got> GetJson(string apiPath, int redirectsLeft = 6)
    {
        var u = apiPath.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || apiPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? new Uri(apiPath) : new Uri(api + apiPath);
        Lookups.Allowed(u.ToString());
        using var cts = new CancellationTokenSource(15000);
        using var req = new HttpRequestMessage(HttpMethod.Get, u);
        req.Headers.TryAddWithoutValidation("User-Agent", "musicd-server-updater");
        req.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
        if (token != null && u.Host == "api.github.com") req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
        HttpResponseMessage res;
        try { res = await Web.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token); }
        catch (OperationCanceledException) { throw new UpdateError("GitHub API timeout"); }
        catch (HttpRequestException e) { throw new UpdateError(e.InnerException?.Message ?? e.Message); }
        using (res)
        {
            var code = (int)res.StatusCode;
            if (code is 301 or 302 or 307 or 308 && res.Headers.Location is { } loc)
            {
                if (redirectsLeft <= 0) throw new UpdateError("too many redirects");
                // Location may be relative — resolved against the current origin.
                return await GetJson(new Uri(new Uri(u.GetLeftPart(UriPartial.Authority)), loc).ToString(), redirectsLeft - 1);
            }
            string data;
            try { data = await res.Content.ReadAsStringAsync(cts.Token); }
            catch (OperationCanceledException) { throw new UpdateError("GitHub API timeout"); }
            if (code is >= 200 and < 300)
            {
                try { return new Got(code, JsJson.Parse(data), null); }
                catch (JsError e) { throw new UpdateError(e.Message); }
            }
            return new Got(code, null, data);
        }
    }

    /* downloadFile: to [dest]; redirects followed, six at most; the token to api.github.com alone. */
    private async Task Download(string url, string dest, int redirectsLeft = 6)
    {
        var u = new Uri(url);
        Lookups.Allowed(url);
        using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        using var req = new HttpRequestMessage(HttpMethod.Get, u);
        req.Headers.TryAddWithoutValidation("User-Agent", "musicd-server-updater");
        req.Headers.TryAddWithoutValidation("Accept", "application/octet-stream");
        if (token != null && u.Host == "api.github.com") req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
        HttpResponseMessage res;
        try { res = await Web.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token); }
        catch (OperationCanceledException) { throw new UpdateError("download timed out"); }
        catch (HttpRequestException e) { throw new UpdateError(e.InnerException?.Message ?? e.Message); }
        using (res)
        {
            var code = (int)res.StatusCode;
            if (code is 301 or 302 or 303 or 307 or 308 && res.Headers.Location is { } loc)
            {
                if (redirectsLeft <= 0) throw new UpdateError("too many redirects");
                await Download(new Uri(u, loc).ToString(), dest, redirectsLeft - 1);
                return;
            }
            if (code != 200) throw new UpdateError("download HTTP " + code);
            // The body under the same ten minutes, and the same words when it stops short.
            try
            {
                await using var f = File.Create(dest);
                await using var body = await res.Content.ReadAsStreamAsync(cts.Token);
                await body.CopyToAsync(f, cts.Token);
            }
            catch (OperationCanceledException) { throw new UpdateError("download timed out"); }
            catch (HttpRequestException e) { throw new UpdateError(e.InnerException?.Message ?? e.Message); }
        }
    }

    // ------------------------------------------------------------------ status

    /* getStatus(), with what api-playlists.js lays over it: is_docker and csharp (the Node server's word on this program's update). */
    public JsObj Status(object? csharp)
    {
        lock (gate)
        {
            var apply = new JsObj();
            apply["phase"] = phase;
            apply["error"] = applyError;
            apply["version"] = applyVersion;
            var o = new JsObj();
            o["current"] = current;
            o["latest"] = latest;
            o["latestTag"] = latestTag;
            o["available"] = available;
            o["isDowngrade"] = false;
            o["html_url"] = htmlUrl;
            o["notes"] = notes;
            o["source"] = source;
            o["checkedAt"] = checkedAt;
            o["checking"] = checking;
            o["error"] = error;
            o["viaLauncher"] = viaLauncher;
            o["apply"] = apply;
            o["is_docker"] = Environment.GetEnvironmentVariable("DOCKER") == "1";
            o["csharp"] = csharp;
            // A Mac on the Node server alone: never, with this server in front.
            o["mac_node_only"] = false;
            return o;
        }
    }

    /* checkNow: GitHub asked; a check under way is left to it. */
    public Task CheckNow()
    {
        lock (gate)
        {
            if (checking) return check ?? Task.CompletedTask;
            checking = true;
            error = null;
            return check = Task.Run(Check);
        }
    }

    private async Task Check()
    {
        try
        {
            JsObj? rel = null;
            string? src = null;
            var r = await GetJson($"/repos/{owner}/{repo}/releases/latest");
            if (r.Status == 200 && r.Json is JsObj rj && Js.Truthy(rj["tag_name"])) { rel = rj; src = "release"; }
            else if (r.Status == 404)
            {
                // No published release — fall back to the highest semver tag.
                var t = await GetJson($"/repos/{owner}/{repo}/tags?per_page=30");
                if (t.Status == 200 && t.Json is List<object?> tags && tags.Count > 0)
                {
                    JsObj? best = null;
                    foreach (var tag in tags.OfType<JsObj>())
                        if (ParseVer(tag["name"]) != null && (best == null || CmpVer(tag["name"], best["name"]) > 0)) best = tag;
                    if (best != null)
                    {
                        src = "tags";
                        var name = Js.Str(best["name"]);
                        rel = new JsObj();
                        rel["tag_name"] = best["name"];
                        rel["html_url"] = $"https://github.com/{owner}/{repo}/releases/tag/{name}";
                        rel["body"] = null;
                        rel["assets"] = new List<object?>();
                        rel["_tarball"] = $"https://api.github.com/repos/{owner}/{repo}/tarball/{name}";
                    }
                }
            }
            else if (r.Status == 403) throw new UpdateError("GitHub rate-limited or forbidden (set GITHUB_TOKEN to raise the limit)");
            else if (r.Status >= 400) throw new UpdateError("GitHub API HTTP " + r.Status);

            lock (gate)
            {
                if (rel != null)
                {
                    var tag = Js.Str(rel["tag_name"]);
                    var ver = ParseVer(tag) != null ? TrimV(tag) : tag;
                    var assets = rel["assets"] as List<object?> ?? [];
                    var tarAsset = assets.OfType<JsObj>().FirstOrDefault(a => Tarball().IsMatch(Js.IsNullish(a["name"]) ? "" : Js.Str(a["name"])));
                    latest = ver;
                    latestTag = rel["tag_name"];
                    htmlUrl = Js.Truthy(rel["html_url"]) ? rel["html_url"] : null;
                    var body = Js.Trim(Js.IsNullish(rel["body"]) ? "" : Js.Str(rel["body"]));
                    if (body.Length > 3000) body = body[..3000];
                    notes = body.Length > 0 ? body : null;
                    source = src;
                    downloadUrl = tarAsset != null ? tarAsset["browser_download_url"] : Js.Truthy(rel["tarball_url"]) ? rel["tarball_url"] : Js.Truthy(rel["_tarball"]) ? rel["_tarball"] : null;
                    var diff = ParseVer(ver) != null && ParseVer(current) != null ? CmpVer(ver, current) : 0;
                    // Only ever forwards: a build newer than the last release is not offered a "rollback".
                    available = diff > 0;
                }
                else { latest = null; latestTag = null; available = false; source = null; downloadUrl = null; }
                checkedAt = NowMs();
            }
            Debug($"checked: {Js.Str(latest)} available={(available ? "true" : "false")} src={Js.Str(source)}");
        }
        catch (Exception e) when (e is UpdateError or LookupError or IOException)
        {
            lock (gate) error = e.Message;
            Debug("check failed: " + e.Message);
        }
        finally { lock (gate) { checking = false; check = null; } }
    }

    private static string TrimV(string tag) { var t = Js.Trim(tag); return t.StartsWith('v') || t.StartsWith('V') ? t[1..] : t; }
    [GeneratedRegex(@"\.(tgz|tar\.gz)$", RegexOptions.IgnoreCase)] private static partial Regex Tarball();

    // ------------------------------------------------------------------- apply

    /*
     * apply: the update made, or why not (apply.phase "error"). A phase in the
     * middle of one: left to it (the check it starts with too: two asks at once
     * would download the same file twice, which lib/updater.js, on one thread,
     * never had to fear).
     */
    public async Task Apply()
    {
        lock (gate)
        {
            if (Busy.Contains(phase) || phase == "checking") return;
            phase = "checking"; applyError = null; applyVersion = null;
        }
        bool have;
        lock (gate) have = available && !Js.IsNullish(downloadUrl);
        if (!have)
        {
            await CheckNow();
            lock (gate)
            {
                if (!available || Js.IsNullish(downloadUrl))
                {
                    phase = "error"; applyError = error ?? "No update available"; applyVersion = null;
                    return;
                }
            }
        }
        string target, url;
        lock (gate) { target = Js.Str(latest); url = Js.Str(downloadUrl); }
        var upd = Path.Combine(dir, ".update");
        var dlFile = Path.Combine(upd, "download.tgz");
        var exRoot = Path.Combine(upd, "extract");
        try
        {
            Directory.CreateDirectory(upd);
            try { Directory.Delete(exRoot, true); } catch (IOException) { /* none yet */ } catch (UnauthorizedAccessException) { /* left to the copy */ }
            Directory.CreateDirectory(exRoot);

            Phase("downloading", target);
            Debug("downloading " + url);
            await Download(url, dlFile);

            Phase("extracting", target);
            if (!Extract(dlFile, exRoot)) throw new UpdateError("extraction failed (is `tar` installed and on PATH?)");
            var top = TopLevelDir(exRoot);
            var staged = top != null ? Path.Combine(exRoot, top) : exRoot;
            if (!File.Exists(Path.Combine(staged, "index.js")) || !File.Exists(Path.Combine(staged, "package.json")))
                throw new UpdateError("downloaded build is missing index.js/package.json");
            string? stagedName = null;
            try { stagedName = (JsonNode.Parse(File.ReadAllText(Path.Combine(staged, "package.json"))) as JsonObject)?["name"] is JsonValue nv && nv.TryGetValue<string>(out var sn) ? sn : null; }
            catch (Exception e) when (e is System.Text.Json.JsonException or IOException) { /* not a package */ }
            if (stagedName != PackageName) throw new UpdateError("downloaded build is " + (stagedName ?? "something else") + ", not " + PackageName);

            // What has to come with it, ready before anything is staged (v0.8.29):
            // this program of the new version. It throws if it can't be had, and
            // the update stops here with nothing changed.
            Phase("preparing", target);
            await Prepare(target);

            if (viaLauncher)
            {
                File.WriteAllText(Path.Combine(upd, "READY"), new JsonObject { ["staged"] = staged, ["version"] = target }.ToJsonString());
                Phase("restarting", target);
                Debug("staged; the Node server asked to start again (75) for the launcher to apply + restart");
            }
            else
            {
                ApplyStaged(staged, dir, log);
                try { Directory.Delete(upd, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left behind */ }
                Phase("restarting", target);
                Debug("applied in place; the Node server asked to start again (75)");
            }
            _ = Task.Delay(400).ContinueWith(_ => Jobs.RestartNode("update"), TaskScheduler.Default);
        }
        // Whatever stopped it (lib/updater.js catches everything): the phase ends in
        // "error", never left in the middle, where every later ask would be turned away.
        catch (Exception e)
        {
            lock (gate) { phase = "error"; applyError = e.Message; applyVersion = target; }
            Debug("apply failed: " + e.Message);
        }
    }

    private void Phase(string p, string version) { lock (gate) { phase = p; applyError = null; applyVersion = version; } }

    /* The downloaded release unpacked, by the system's tar; no shell (a path with a space stays one argument). */
    private static bool Extract(string file, string dest)
    {
        try
        {
            var psi = new ProcessStartInfo("tar") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in new[] { "-xzf", file, "-C", dest }) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi);
            if (p == null) return false;
            _ = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10 * 60 * 1000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return false; }
            return p.ExitCode == 0;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { return false; }
    }

    /* A GitHub source tarball wraps everything in one top-level dir, the release's bundle in musicd-server/: that single dir, or null. */
    private static string? TopLevelDir(string root)
    {
        var entries = Directory.GetFileSystemEntries(root);
        return entries.Length == 1 && Directory.Exists(entries[0]) ? Path.GetFileName(entries[0]) : null;
    }

    /* applyStaged: the staged build laid over the install dir (never the data, node_modules, .git…), and npm install if the dependencies changed. */
    public static void ApplyStaged(string stagedDir, string targetDir, Action<string> log)
    {
        static string Deps(string dirOf)
        {
            try { return ((JsonNode.Parse(File.ReadAllText(Path.Combine(dirOf, "package.json"))) as JsonObject)?["dependencies"] as JsonObject)?.ToJsonString() ?? "{}"; }
            catch (Exception e) when (e is System.Text.Json.JsonException or IOException) { return "{}"; }
        }
        var oldDeps = Deps(targetDir);
        CopyOverlay(stagedDir, targetDir);
        var newDeps = Deps(targetDir);
        if (oldDeps != newDeps)
        {
            log("dependencies changed — running npm install");
            try
            {
                var psi = new ProcessStartInfo("npm") { UseShellExecute = false, WorkingDirectory = targetDir };
                foreach (var a in new[] { "install", "--omit=dev", "--no-audit", "--no-fund" }) psi.ArgumentList.Add(a);
                using var p = Process.Start(psi);
                if (p == null || !p.WaitForExit(5 * 60 * 1000)) { try { p?.Kill(); } catch (InvalidOperationException) { /* gone */ } log("npm install exited with status null (continuing)"); }
                else if (p.ExitCode != 0) log("npm install exited with status " + p.ExitCode + " (continuing)");
            }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { log("npm install exited with status null (continuing)"); }
        }
    }

    // copyOverlay: src over dest, recursively, the names in Skip left alone.
    private static void CopyOverlay(string src, string dest)
    {
        foreach (var name in Directory.GetFileSystemEntries(src).Select(Path.GetFileName).OfType<string>().Order(StringComparer.Ordinal))
        {
            if (Skip.Contains(name)) continue;
            var s = Path.Combine(src, name);
            var d = Path.Combine(dest, name);
            if (Directory.Exists(s)) { Directory.CreateDirectory(d); CopyOverlay(s, d); }
            else File.Copy(s, d, overwrite: true);
        }
    }

    // --------------------------------------------- this program, of the new version

    [LibraryImport("libc", EntryPoint = "access", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Access(string path, int mode);

    private static bool Writable(string d)
    {
        try { return Access(d, 2) == 0; }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { return true; }
    }

    private static (string Platform, string Arch) Machine() => (
        OperatingSystem.IsLinux() ? "linux" : OperatingSystem.IsMacOS() ? "darwin" : OperatingSystem.IsWindows() ? "win32" : "other",
        RuntimeInformation.ProcessArchitecture switch { Architecture.X64 => "x64", Architecture.Arm64 => "arm64", Architecture.X86 => "ia32", Architecture.Arm => "arm", _ => "other" });
    private static string? Build() => Machine() switch
    {
        ("linux", "x64") => "linux-x64", ("linux", "arm64") => "linux-arm64", ("darwin", "x64") => "osx-x64", ("darwin", "arm64") => "osx-arm64", _ => null
    };
    /* The program this one runs from: told (the tests) or its own file. */
    public static string BinPath() => Env("MANDARIN_SERVER_BIN") ?? Environment.ProcessPath ?? "";

    /*
     * csharp-update.js prepare: this program of the version being installed,
     * fetched, checked and put in place before the update stages anything;
     * throws, and nothing has changed, when it can't be had. Nothing to do with
     * its updates switched off.
     */
    private async Task Prepare(string target)
    {
        if (Env("MANDARIN_SERVER_UPDATE") == "0") return;
        var (platform, arch) = Machine();
        var mac = platform == "darwin";
        var getAgain = mac ? "run the install line again (README, Install on a Mac)" : "pull the image again (docker pull)";
        if (Build() == null) throw new UpdateError($"no C# server is built for this machine ({platform} {arch}); the update would leave it behind");
        var bin = BinPath();
        if (bin.Length == 0 || !File.Exists(bin)) throw new UpdateError($"no C# server at {bin}");
        var binDir = Path.GetDirectoryName(bin) ?? ".";
        if (!Writable(binDir)) throw new UpdateError($"{binDir} can't be written to; {getAgain} instead");
        log($"[update] fetching the C# server {target} before the update");
        string next;
        try { next = await FetchProgram(bin, target, mac); }
        catch (Exception e)
        {
            throw new UpdateError($"the C# server {target} couldn't be fetched ({e.Message}); nothing was changed");
        }
        File.Move(next, bin, overwrite: true);
        File.WriteAllText(bin + ".version", target + "\n");
        log($"[update] the C# server {target} is in place; it starts with the update");
    }

    /* fetchProgram: the program for this machine from release v<v>, checked, put beside [bin] as <bin>.new. */
    private async Task<string> FetchProgram(string bin, string v, bool mac)
    {
        var name = $"mandarin-server-{Build()}.gz";
        var r = await GetJson($"/repos/{owner}/{repo}/releases/tags/v{v}");
        if (r.Status != 200 || r.Json is not JsObj rel) throw new UpdateError($"release v{v} not found (HTTP {r.Status})");
        var assets = (rel["assets"] as List<object?> ?? []).OfType<JsObj>().ToList();
        var gz = assets.FirstOrDefault(a => Js.StrictEq(a["name"], name));
        var sums = assets.FirstOrDefault(a => Js.StrictEq(a["name"], Sums));
        if (gz == null || sums == null) throw new UpdateError($"release v{v} carries no {name}");
        string dl = bin + ".download", sumsFile = bin + ".sha256", next = bin + ".new";
        try
        {
            await Download(Js.Str(sums["browser_download_url"]), sumsFile);
            string? sum = null;
            foreach (var l in File.ReadAllText(sumsFile).Split('\n'))
            {
                var parts = SumLine().Split(Js.Trim(l));
                if (parts.Length >= 2 && parts[1] == name) { sum = parts[0]; break; }
            }
            if (sum == null || !Hex64().IsMatch(sum)) throw new UpdateError($"no sum for {name}");
            await Download(Js.Str(gz["browser_download_url"]), dl);
            string got;
            await using (var f = File.OpenRead(dl)) got = Convert.ToHexStringLower(await SHA256.HashDataAsync(f));
            if (!got.Equals(sum, StringComparison.OrdinalIgnoreCase)) throw new UpdateError($"{name} doesn't match its sum");
            await using (var src = File.OpenRead(dl))
            await using (var gunzip = new GZipStream(src, CompressionMode.Decompress))
            await using (var dst = File.Create(next))
                await gunzip.CopyToAsync(dst);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(next, (UnixFileMode)Convert.ToInt32("755", 8));
            // A Mac runs nothing unsigned: the release's is signed (ad hoc) where it is built; signed here again if that didn't come through.
            if (mac && !Codesign(next)) throw new UpdateError("the new program couldn't be signed to run on this Mac");
            // It runs here, and is the version it should be.
            var said = Run(next, ["--version"], 30000, ("DOTNET_CLI_TELEMETRY_OPTOUT", "1"));
            var got2 = Js.Trim(said.Out);
            if (said.Code != 0 || got2 != v) throw new UpdateError($"the new program says {(got2.Length > 0 ? got2 : said.Error ?? "nothing")}, not {v}");
            return next;
        }
        catch
        {
            try { File.Delete(next); } catch (IOException) { /* gone */ }
            throw;
        }
        finally
        {
            foreach (var f in new[] { dl, sumsFile }) { try { File.Delete(f); } catch (IOException) { /* gone */ } }
        }
    }

    [GeneratedRegex(@"\s+\*?")] private static partial Regex SumLine();
    [GeneratedRegex(@"^[0-9a-f]{64}$", RegexOptions.IgnoreCase)] private static partial Regex Hex64();

    /* An ad hoc signature, where the program's own doesn't hold: false if it can't be had. */
    private static bool Codesign(string file)
    {
        if (Run("codesign", ["--verify", file], 30000).Code == 0) return true;
        return Run("codesign", ["--force", "--sign", "-", file], 60000).Code == 0;
    }

    /* A program run to its end: its exit code (-1 if it couldn't be started), its output, and why it couldn't start. */
    private static (int Code, string Out, string? Error) Run(string bin, string[] args, int timeoutMs, params (string, string)[] env)
    {
        try
        {
            var psi = new ProcessStartInfo(bin) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            foreach (var (k, val) in env) psi.Environment[k] = val;
            using var p = Process.Start(psi);
            if (p == null) return (-1, "", "couldn't start");
            var outText = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return (-1, "", "timed out"); }
            return (p.ExitCode, outText.Result, null);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { return (-1, "", e.Message); }
    }

    // ---------------------------------------------------------------- by itself

    /* startAuto: a check half a minute on, then every twelve hours (UPDATE_CHECK=false: never). */
    public void Start()
    {
        Stop();
        if (!Checks) return;
        timer = new Timer(_ => CheckNow(), null, 30000, 12 * 3600 * 1000);
    }

    public void Stop() { timer?.Dispose(); timer = null; }
}

internal sealed class UpdateError(string message) : Exception(message);
