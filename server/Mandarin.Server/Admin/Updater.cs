// Updater.cs — the in-app update (v0.8.48, stage 5 part 4 of
// old/csharp-migration.md): lib/updater.js, and the part of
// lib/server/csharp-update.js an update calls first (prepare), rule for rule.
//
// GitHub is asked for the latest release (or, with none published, the highest
// version among the tags), its version compared with this one's, and on
// request the release's bundle downloaded, unpacked with the system's tar,
// checked (package.json, the package's name), then — before anything is laid
// in — this program of the new version fetched for this machine, checked
// against the release's SHA-256 sums and asked its version, and put beside
// the running one. Then the bundle's files are laid over the install (never
// the data), the new program swapped in last (Updater.Swap.cs), and this one
// starts again from the new file, in the same process (Jobs.Restart, Server.StartAgain).
//
// The check by itself: half a minute after the start, then every twelve hours
// (UPDATE_CHECK=false: never). The job "update" (Jobs.cs).
//
//   UPDATE_REPO    owner/repo (meltface-80/Mandarin); UPDATE_API where GitHub
//                  is asked (the tests' stand-in)
//   GITHUB_TOKEN   sent to api.github.com alone, never to a host a redirect names
//   MANDARIN_SERVER_UPDATE=0   this program left as it is by an update
using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
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
    private readonly bool debug;
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

    /* [cfg]: the configuration (Config.cs): where GitHub is asked, and whether to check by itself. */
    public Updater(JsonObject cfg, string appDir, string version, Action<string> log)
    {
        static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
        var repoSpec = Text(cfg["update_repo"]) ?? Env("UPDATE_REPO") ?? "meltface-80/Mandarin";
        var slash = repoSpec.IndexOf('/');
        owner = slash < 0 ? repoSpec : repoSpec[..slash];
        repo = slash < 0 ? "" : repoSpec[(slash + 1)..];
        api = Text(cfg["update_api"]) ?? Env("UPDATE_API") ?? "https://api.github.com";
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
            catch (HttpRequestException e) { throw new UpdateError(e.InnerException?.Message ?? e.Message); }   // the connection dropped mid-answer (item 180)
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

    /* getStatus(), with what api-playlists.js lays over it: is_docker, and csharp (null: the Node server's word on this program's update, gone with it). */
    public JsObj Status()
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
            o["viaLauncher"] = false;
            o["apply"] = apply;
            o["is_docker"] = Environment.GetEnvironmentVariable("DOCKER") == "1";
            o["csharp"] = null;
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
                    notes = ReleaseNotes.Short(Js.IsNullish(rel["body"]) ? null : Js.Str(rel["body"]));
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
        // Whatever stopped it ends it with its error (item 180): a faulted check left Apply, which waits on it, in "checking".
        catch (Exception e)
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
        var upd = Path.Combine(dir, ".update");
        var dlFile = Path.Combine(upd, "download.tgz");
        var exRoot = Path.Combine(upd, "extract");
        string? applying = null;
        try
        {
            // The check it may start with inside too (item 180): one that fails ends the phase in "error", never "checking".
            bool have;
            lock (gate) have = available && !Js.IsNullish(downloadUrl);
            if (!have)
            {
                await CheckNow();
                lock (gate)
                {
                    if (!available || Js.IsNullish(downloadUrl)) { phase = "error"; applyError = error ?? "No update available"; applyVersion = null; return; }
                }
            }
            string target, url;
            lock (gate) { target = Js.Str(latest); url = Js.Str(downloadUrl); }
            applying = target;
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
            if (!File.Exists(Path.Combine(staged, "package.json"))) throw new UpdateError("downloaded build is missing package.json");
            string? stagedName = null;
            try { stagedName = (JsonNode.Parse(File.ReadAllText(Path.Combine(staged, "package.json"))) as JsonObject)?["name"] is JsonValue nv && nv.TryGetValue<string>(out var sn) ? sn : null; }
            catch (Exception e) when (e is System.Text.Json.JsonException or IOException) { /* not a package */ }
            if (stagedName != PackageName) throw new UpdateError("downloaded build is " + (stagedName ?? "something else") + ", not " + PackageName);

            // What has to come with it, ready before anything is staged (v0.8.29):
            // this program of the new version. It throws if it can't be had, and
            // the update stops here with nothing changed. Swapped in last (item 180).
            Phase("preparing", target);
            LayIn(staged, await Prepare(staged, target), target);
            try { Directory.Delete(upd, true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left behind */ }
            Phase("restarting", target);
            Debug("applied in place; this program starts again from the new file");
            _ = Task.Delay(400).ContinueWith(_ => Jobs.Restart(), TaskScheduler.Default);
        }
        // Whatever stopped it (lib/updater.js catches everything): the phase ends in
        // "error", never left in the middle, where every later ask would be turned away.
        catch (Exception e)
        {
            lock (gate) { phase = "error"; applyError = e.Message; applyVersion = applying; }
            Debug("apply failed: " + e.Message);
        }
    }

    private void Phase(string p, string version) { lock (gate) { phase = p; applyError = null; applyVersion = version; } }

    /* The downloaded release unpacked, by the system's tar; no shell (a path with a space stays one argument). */
    internal static bool Extract(string file, string dest)
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

    /* applyStaged: the staged build laid over the install dir (never the data, node_modules, .git…). */
    public static void ApplyStaged(string stagedDir, string targetDir) => CopyOverlay(stagedDir, targetDir);

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
