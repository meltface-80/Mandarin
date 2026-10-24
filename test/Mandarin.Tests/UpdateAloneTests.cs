using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The in-app update with no Node server anywhere (v0.8.50; Admin/Updater.cs): the server asks GitHub,
/// downloads and checks the release's bundle (its package.json names it), fetches its own program of the
/// new version and puts it in place of the file it runs from, lays the bundle's files over the install
/// (never the data), and starts again from the new file in its own process — no launcher, no npm. Each
/// refusal leaves nothing changed. GitHub is stood in for; the server runs for real, from a copy of its
/// program in an install of its own, so nothing of this checkout is touched. The new program is a
/// stand-in that writes down how it was started and leaves (test/update-alone.test.js, in C#).
/// </summary>
public sealed class UpdateAloneTests
{
    private static string Version => (string)JsonNode.Parse(File.ReadAllText(Path.Combine(ServerProcess.Root, "package.json")))!["version"]!;

    // The program's build for this machine, as Admin/Updater.cs names it (release.yml's assets).
    private static string? Build => (OperatingSystem.IsLinux() ? "linux-" : OperatingSystem.IsMacOS() ? "osx-" : null) is { } os
        ? RuntimeInformation.OSArchitecture switch { Architecture.X64 => os + "x64", Architecture.Arm64 => os + "arm64", _ => null } : null;

    // GitHub, stood in for: the latest release (or a status instead), the release of v9.9.9 the program is fetched from, and the files of both.
    private sealed class Fake
    {
        public JsonNode? Latest;
        public int LatestStatus = 404;
        public JsonNode? Tag;
        public readonly Dictionary<string, byte[]> Files = [];
        public string Gh = "";
    }

    private static void Run(string file, params string[] args)
    {
        var psi = new ProcessStartInfo(file) { RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, file + ": " + err);
    }

    // The release's bundle (musicd-server/ at the top), without a Node server in it: package.json, a page, a file of its own.
    private static void Bundle(Fake fake, string tmp, string name = "musicd-server", bool withPackage = true)
    {
        var dir = Directory.CreateDirectory(Path.Combine(tmp, "bundle-" + Guid.NewGuid().ToString("N")[..8])).FullName;
        var top = Path.Combine(dir, "musicd-server");
        Directory.CreateDirectory(Path.Combine(top, "public"));
        File.WriteAllText(Path.Combine(top, "public", "new.js"), "// new in 9.9.9\n");
        File.WriteAllText(Path.Combine(top, "README.md"), "# 9.9.9\n");
        var p = JsonNode.Parse(File.ReadAllText(Path.Combine(ServerProcess.Root, "package.json")))!.AsObject();
        p["name"] = name; p["version"] = "9.9.9";
        if (withPackage) File.WriteAllText(Path.Combine(top, "package.json"), p.ToJsonString(new() { WriteIndented = true }));
        var output = Path.Combine(dir, "musicd-server-9.9.9.tar.gz");
        Run("tar", "-C", dir, "-czf", output, "musicd-server");
        fake.Files["/dl/musicd-server-9.9.9.tar.gz"] = File.ReadAllBytes(output);
        fake.Latest = JsonNode.Parse(Http.Json(new { tag_name = "v9.9.9", html_url = fake.Gh + "/r", body = "Notes for 9.9.9",
            assets = new[] { new { name = "musicd-server-9.9.9.tar.gz", browser_download_url = fake.Gh + "/dl/musicd-server-9.9.9.tar.gz" } } }));
    }

    // The release of 9.9.9 the program is fetched from: a stand-in that says 9.9.9 (or says), and started
    // writes down how (to marker) and leaves with 3; its sum right unless badSum.
    private static byte[] Program(Fake fake, string marker, bool withProgram = true, string says = "9.9.9", bool badSum = false)
    {
        var prog = Encoding.UTF8.GetBytes($"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo {says}; exit 0; fi\necho \"$0|$#|$*\" > \"{marker}\"\nexit 3\n");
        using var ms = new MemoryStream();
        using (var z = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true)) z.Write(prog);
        var gz = ms.ToArray();
        var name = $"mandarin-server-{Build}.gz";
        fake.Files["/dl/" + name] = gz;
        var sum = Convert.ToHexStringLower(SHA256.HashData(badSum ? "other"u8.ToArray() : gz));
        fake.Files["/dl/mandarin-server.sha256"] = Encoding.UTF8.GetBytes($"{sum}  {name}\n{new string('0', 64)}  mandarin-server-other.gz\n");
        fake.Tag = JsonNode.Parse(Http.Json(new { tag_name = "v9.9.9", assets = (withProgram ? new[] { name, "mandarin-server.sha256" } : []).Select(n => new { name = n, browser_download_url = fake.Gh + "/dl/" + n }) }));
        return prog;
    }

    private static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.GetDirectories(from)) CopyTree(d, Path.Combine(to, Path.GetFileName(d)));
    }

    [Test]
    public async Task The_in_app_update_with_no_Node_server_refused_with_nothing_changed_then_made_and_started_again_from_the_new_file()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (Build == null) Assert.Skip("no C# server is built for this machine");
        var fake = new Fake();
        await using var gh = await FakeServer.Start(async ctx =>
        {
            var u = ctx.Request.Path.Value ?? "";
            async Task Send(int code, byte[] body, string type = "application/json") { ctx.Response.StatusCode = code; ctx.Response.ContentType = type; await ctx.Response.Body.WriteAsync(body); }
            if (u == "/repos/me/musicd/releases/latest") { await (fake.Latest != null ? Send(200, Encoding.UTF8.GetBytes(fake.Latest.ToJsonString())) : Send(fake.LatestStatus, "{}"u8.ToArray())); return; }
            if (u == "/repos/me/musicd/releases/tags/v9.9.9") { await (fake.Tag != null ? Send(200, Encoding.UTF8.GetBytes(fake.Tag.ToJsonString())) : Send(404, "{}"u8.ToArray())); return; }
            if (fake.Files.TryGetValue(u, out var f)) { await Send(200, f, "application/octet-stream"); return; }
            await Send(404, "{}"u8.ToArray());
        });
        fake.Gh = gh.Base;
        var tmp = Directory.CreateTempSubdirectory("musicd-upd-gh-").FullName;
        var realBin = new FileInfo(ServerProcess.Bin);
        var (realSize, realTime) = (realBin.Length, realBin.LastWriteTimeUtc);

        // An install apart from this checkout: the pages, package.json, and a copy of the program, which the server runs from.
        var dir = Directory.CreateTempSubdirectory("musicd-upd-alone-").FullName;
        var app = Path.Combine(dir, "app");
        Directory.CreateDirectory(app);
        File.Copy(Path.Combine(ServerProcess.Root, "package.json"), Path.Combine(app, "package.json"));
        CopyTree(Path.Combine(ServerProcess.Root, "public"), Path.Combine(app, "public"));
        var bin = Path.Combine(app, "server", "bin", "mandarin-server");
        Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
        File.Copy(ServerProcess.Bin, bin);
        var marker = Path.Combine(dir, "started");

        var lib = Fixtures.MakeLibrary();
        Directory.CreateDirectory(lib.Data);
        await File.WriteAllTextAsync(Path.Combine(lib.Data, "keep.txt"), "mine");
        var srv = await ServerProcess.Start(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = app, ["UPDATE_API"] = gh.Base, ["UPDATE_REPO"] = "me/musicd" }, bin);
        try
        {
            var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) };
            async Task<(int Status, string? By, JsonNode Body)> Api(string p, bool post = false)
            {
                var r = post ? await Http.Post(srv.Base + "/api/update/" + p, new { }, h) : await Http.Get(srv.Base + "/api/update/" + p, h);
                return (r.Status, r.Header("x-mandarin-answered"), r.J);
            }
            void Refused((int Status, string? By, JsonNode Body) r, string error, string? why = null)
            {
                Assert.True(r.Status == 409, (why ?? error) + ": " + r.Status + " " + r.Body.ToJsonString());
                Assert.Equal(error, r.Body.Str("error"));
            }
            var was = await File.ReadAllBytesAsync(bin);
            var version = Version;

            var st = await Api("status");
            Assert.True((st.By, st.Body.Str("current"), st.Body.Bool("viaLauncher"), st.Body["csharp"] == null, st.Body.AsObject().ContainsKey("mac_node_only")) == ("C#", version, false, true, false),
                "its own, with no launcher and no Node server to match");
            var keys = new[] { "current", "latest", "latestTag", "available", "isDowngrade", "html_url", "notes", "source", "checkedAt", "checking", "error", "apply", "is_docker" };
            var picked = new JsonObject(keys.Select(k => KeyValuePair.Create(k, st.Body[k]?.DeepClone())));
            JsonAssert.Same(Http.Json(new
            {
                current = version, latest = (string?)null, latestTag = (string?)null, available = false, isDowngrade = false, html_url = (string?)null, notes = (string?)null, source = (string?)null,
                checkedAt = 0, checking = false, error = (string?)null, apply = new { phase = "idle", error = (string?)null, version = (string?)null }, is_docker = false
            }), picked, "nothing known yet, as lib/updater.js started");

            // GitHub refusing, or rate-limiting: the check says so; an install asked for then says the same, nothing changed.
            fake.LatestStatus = 500;
            var r = await Api("check", true);
            Assert.Equal(("GitHub API HTTP 500", false, 0.0), (r.Body.Str("error"), r.Body.Bool("available") ?? true, r.Body.Num("checkedAt") ?? -1));
            r = await Api("apply", true);
            Refused(r, "GitHub API HTTP 500");
            JsonAssert.Same("""{"phase":"error","error":"GitHub API HTTP 500","version":null}""", r.Body["status"]?["apply"]);
            fake.LatestStatus = 403;
            Assert.Equal("GitHub rate-limited or forbidden (set GITHUB_TOKEN to raise the limit)", (await Api("check", true)).Body.Str("error"));
            // No release, no tags: nothing on offer.
            fake.LatestStatus = 404;
            r = await Api("check", true);
            Assert.True((r.Body.Str("error"), r.Body.Str("latest"), r.Body.Bool("available"), r.Body.Num("checkedAt") > 0) == (null, null, false, true), "nothing on offer yet");
            Refused(await Api("apply", true), "No update available");
            // A release, its notes trimmed; its bundle not there to download.
            fake.Latest = JsonNode.Parse(Http.Json(new { tag_name = "v9.9.9", html_url = gh.Base + "/r", body = "  Notes for 9.9.9  ",
                assets = new[] { new { name = "musicd-server-9.9.9.tar.gz", browser_download_url = gh.Base + "/dl/musicd-server-9.9.9.tar.gz" } } }));
            r = await Api("check", true);
            Assert.Equal(("9.9.9", "v9.9.9", true, gh.Base + "/r", "Notes for 9.9.9", "release", (string?)null),
                (r.Body.Str("latest"), r.Body.Str("latestTag"), r.Body.Bool("available") ?? false, r.Body.Str("html_url"), r.Body.Str("notes"), r.Body.Str("source"), r.Body.Str("error")));
            r = await Api("apply", true);
            Refused(r, "download HTTP 404");
            JsonAssert.Same("""{"phase":"error","error":"download HTTP 404","version":"9.9.9"}""", r.Body["status"]?["apply"]);

            // A bundle without package.json; one that isn't the server's: refused, as before.
            Bundle(fake, tmp, withPackage: false);
            Refused(await Api("apply", true), "downloaded build is missing package.json");
            Bundle(fake, tmp, name: "other");
            Refused(await Api("apply", true), "downloaded build is other, not musicd-server");
            // The bundle right, no program in the release: nothing changed.
            Bundle(fake, tmp);
            Program(fake, marker, withProgram: false);
            Refused(await Api("apply", true), $"the C# server 9.9.9 couldn't be fetched (release v9.9.9 carries no mandarin-server-{Build}.gz); nothing was changed");
            // One whose sum is wrong, and one that says another version: likewise.
            foreach (var (why, badSum, says, said) in new[] { ("a wrong sum", true, "9.9.9", $"mandarin-server-{Build}.gz doesn't match its sum"), ("the wrong version", false, "1.0.0", "the new program says 1.0.0, not 9.9.9") })
            {
                Program(fake, marker, says: says, badSum: badSum);
                r = await Api("apply", true);
                Refused(r, $"the C# server 9.9.9 couldn't be fetched ({said}); nothing was changed", why);
                Assert.Equal("9.9.9", r.Body["status"]?["apply"].Str("version"));
                Assert.True(Directory.GetFileSystemEntries(Path.GetDirectoryName(bin)!).Select(Path.GetFileName).SequenceEqual(["mandarin-server"]), why + ": nothing left beside the program");
            }
            Assert.True((await File.ReadAllBytesAsync(bin)).AsSpan().SequenceEqual(was), "the program as it was");
            Assert.True((string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(app, "package.json")))!["version"] == version, "the install as it was");
            Assert.True(srv.Exited == null, "still running");

            // Everything there: the program put in place, the files laid in, and the server started again from
            // the new file — which here says how it was started and leaves.
            var prog = Program(fake, marker);
            r = await Api("apply", true);
            Assert.True(r.Status == 200, r.Body.ToJsonString());
            Assert.True(r.Body.Bool("ok"));
            JsonAssert.Same("""{"phase":"restarting","error":null,"version":"9.9.9"}""", r.Body["status"]?["apply"]);
            await srv.Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
            Assert.True(srv.Proc.ExitCode == 3, "the stand-in's own leaving, in the same process");
            // The file as the program knows itself: its real path (a temporary folder may be reached through a link).
            var real = new FileInfo(bin).ResolveLinkTarget(true)?.FullName ?? Path.GetFullPath(bin);
            Assert.True(await File.ReadAllTextAsync(marker) == $"{RealPath(real)}|0|\n", "started from its own file, with the same (no) arguments: " + await File.ReadAllTextAsync(marker));
            Assert.True((await File.ReadAllBytesAsync(bin)).AsSpan().SequenceEqual(prog), "the new program in place");
            Assert.Equal("9.9.9\n", await File.ReadAllTextAsync(bin + ".version"));
            Assert.True((string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(app, "package.json")))!["version"] == "9.9.9", "the install's files are the new version's");
            Assert.True(await File.ReadAllTextAsync(Path.Combine(app, "public", "new.js")) == "// new in 9.9.9\n", "a file new in it");
            Assert.True(File.Exists(Path.Combine(app, "public", "index.html")), "what the bundle doesn't carry left as it was");
            Assert.True(!Directory.Exists(Path.Combine(app, ".update")), "the staging folder cleaned up");
            Assert.True(!Directory.Exists(Path.Combine(app, "node_modules")) && !File.Exists(Path.Combine(app, "index.js")), "nothing of Node brought in");
            Assert.True(await File.ReadAllTextAsync(Path.Combine(lib.Data, "keep.txt")) == "mine", "the data left alone");
            Assert.True(!Directory.Exists(Path.Combine(ServerProcess.Root, ".update")), "nothing staged in this checkout");
            var now = new FileInfo(ServerProcess.Bin);
            Assert.True((now.Length, now.LastWriteTimeUtc) == (realSize, realTime), "the C# server of this checkout untouched");
        }
        finally { await srv.Stop(); }
    }

    // The path with every link on the way resolved, as realpath(3) gives it.
    private static string RealPath(string path)
    {
        var parts = Path.GetFullPath(path).Split('/', StringSplitOptions.RemoveEmptyEntries);
        var at = "/";
        foreach (var part in parts)
        {
            var next = Path.Combine(at, part);
            var info = new FileInfo(next);
            var target = info.Exists ? info.ResolveLinkTarget(true) : new DirectoryInfo(next).ResolveLinkTarget(true);
            at = target?.FullName ?? next;
        }
        return at;
    }

    [Test]
    public async Task Mandarin_server_version_says_its_version_and_nothing_else()
    {
        var r = await ServerCommand.Run(["--version"]);
        Assert.Equal(0, r.Code);
        Assert.Equal(Version + "\n", r.Out);
    }
}
