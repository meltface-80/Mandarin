using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The server's log (Diagnostics.cs), kept as Roon keeps its own (item 389): always on, with no way to switch it off,
/// in rolling plain-text files in &lt;data&gt;/Logs, each line dated in UTC with its level. Each line is kept without
/// what is the owner's alone (their account's name, keys, internet and Tailscale addresses: LogScrubTests) but with
/// what helps (a home-network address, a device's name, item 235). What ASP.NET says when a request throws is kept too.
/// </summary>
public sealed class DiagnosticsTests
{
    private static async Task WrongPassword(Session s)
    {
        try { await Session.SignIn(s.Base, password: "not the password", create: false); }
        catch (InvalidOperationException) { /* turned away, as meant */ }
    }

    private static string Logs(Session s) => Path.Combine(s.Lib.Data, "Logs");

    [Test]
    public async Task The_servers_log_is_always_on_and_holds_what_helps_and_not_the_owners_own()
    {
        // An install from before, switched off: the switch's flag and the old file are there when it starts.
        var lib = Fixtures.MakeLibrary();
        Directory.CreateDirectory(lib.Data);
        File.WriteAllText(Path.Combine(lib.Data, "diagnostics-off"), "");
        File.WriteAllText(Path.Combine(lib.Data, "diagnostics.log"), "2026-11-01 10:00:00 [server] a line from before\n");
        await using var s = await Session.Started(lib: lib);
        Assert.True((await s.Api("diagnostics")).J["on"]!.GetValue<bool>(), "on, whatever was chosen before");
        Assert.False(File.Exists(Path.Combine(lib.Data, "diagnostics-off")), "the old switch let go");
        Assert.Contains("a line from before", File.ReadAllText(Path.Combine(Logs(s), "MandarinServer_before.txt")));

        // Asked to switch off: it stays on, and goes on keeping.
        Assert.True((await s.Api("diagnostics", new { on = false })).J["on"]!.GetValue<bool>(), "it can't be switched off");
        await WrongPassword(s);
        await Session.SignIn(s.Base);
        var log = (await s.Api("diagnostics/log")).Text;
        Assert.Contains("[diagnostics] asked to switch the log off: it stays on", log);
        // The lines as written, "[auth] wrong password from {ip}" and "[auth] signed in: {name} ({kind}) from {ip}":
        // the device's own address and the device's name kept; the account's name nowhere.
        Assert.Contains("[auth] wrong password from 127.0.0.1", log);
        Assert.Contains("[auth] signed in: test (android) from 127.0.0.1", log);
        Assert.DoesNotContain(Session.User, log);

        // On disk, in the file a person would open: what the server is at its head, then each line dated, in UTC, with its level.
        var file = File.ReadAllText(Path.Combine(Logs(s), "MandarinServer_log.txt"));
        Assert.StartsWith("# Mandarin Server ", file);
        Assert.Contains("# Installed as: ", file);
        Assert.Contains("# Time zone: ", file);
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  INFO   \[auth\] wrong password from 127\.0\.0\.1$", RegexOptions.Multiline), file);
        Assert.DoesNotContain(Session.User, file);
    }

    [Test]
    public async Task The_log_rolls_into_twenty_files_and_no_more()
    {
        // Files of a few hundred bytes, so a few hundred lines roll them past the twenty kept.
        await using var s = await Session.Started(env: new Dictionary<string, string> { ["MANDARIN_LOG_BYTES"] = "600" });
        for (var i = 0; i < 60; i++) await s.Api("diagnostics", new { on = false });
        var names = Directory.GetFiles(Logs(s), "MandarinServer_log*.txt").Select(f => Path.GetFileName(f)!).Order().ToArray();
        Assert.Equal(["MandarinServer_log.01.txt", "MandarinServer_log.02.txt", "MandarinServer_log.03.txt", "MandarinServer_log.04.txt",
            "MandarinServer_log.05.txt", "MandarinServer_log.06.txt", "MandarinServer_log.07.txt", "MandarinServer_log.08.txt",
            "MandarinServer_log.09.txt", "MandarinServer_log.10.txt", "MandarinServer_log.11.txt", "MandarinServer_log.12.txt",
            "MandarinServer_log.13.txt", "MandarinServer_log.14.txt", "MandarinServer_log.15.txt", "MandarinServer_log.16.txt",
            "MandarinServer_log.17.txt", "MandarinServer_log.18.txt", "MandarinServer_log.19.txt", "MandarinServer_log.20.txt",
            "MandarinServer_log.txt"], names);
        // Each file opens with the header; the newest holds the last line; the log read back runs oldest first.
        foreach (var f in Directory.GetFiles(Logs(s), "MandarinServer_log*.txt")) Assert.StartsWith("# Mandarin Server ", File.ReadAllText(f));
        var text = (await s.Api("diagnostics/log")).Text;
        Assert.EndsWith("[diagnostics] asked to switch the log off: it stays on\n", text);
        Assert.True((await s.Api("diagnostics")).J["bytes"]!.GetValue<long>() < 21 * 4000, "about twenty files' worth, no more");
    }

    [Test]
    public async Task A_request_that_throws_is_in_the_log_with_why()
    {
        await using var s = await Session.Started();
        // A Bridge update asked for with a body that isn't JSON: the route reads it without a try, and throws.
        var r = await Http.Send(HttpMethod.Post, s.Base + "/api/update/bridges/apply", new StringContent("not json", System.Text.Encoding.UTF8, "application/json"), s.H);
        Assert.Equal(500, r.Status);
        await Session.Until(async () => (await s.Api("diagnostics/log")).Text.Contains("[aspnet]"), 5000, "ASP.NET's line");
        var log = (await s.Api("diagnostics/log")).Text;
        Assert.Matches(new Regex(@"UTC  ERROR  \[aspnet\] .*unhandled exception", RegexOptions.IgnoreCase), log);
        // Why, and where: the exception's own words and the server's frames of its stack.
        Assert.True(log.Contains("JsonReaderException: 'not json' is an invalid JSON literal") && log.Contains("at Mandarin.Server."), log);
    }

    [Test]
    public async Task The_pages_errors_are_kept_scrubbed_and_held_to_a_few()
    {
        await using var s = await Session.Started();
        var h = new Dictionary<string, string>(s.H) { ["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };
        var lines = Enumerable.Range(0, 30).Select(i => new { level = "ERROR", text = $"[page] TypeError: x is undefined #{i} for owner@example.com" }).ToArray();
        var r = await Http.Post(s.Base + "/api/diagnostics/page", new { lines }, h);
        Assert.Equal(20, r.J["kept"]!.GetValue<int>());   // at most 20 a request
        var web = File.ReadAllText(Path.Combine(Logs(s), "Web", "MandarinWeb_log.txt"));
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  ERROR  \[Mac · Chrome\] \[page\] TypeError: x is undefined #0 for \[email\]$", RegexOptions.Multiline), web);
        Assert.DoesNotContain("owner@example.com", web);
        Assert.DoesNotContain("#20 ", web);
        // Not signed in: nothing kept.
        Assert.Equal(401, (await Http.Post(s.Base + "/api/diagnostics/page", new { lines }, null)).Status);
    }

    [Test]
    public async Task Every_log_comes_down_as_one_zip()
    {
        await using var s = await Session.Started();
        await Http.Post(s.Base + "/api/diagnostics/page", new { lines = new[] { new { level = "ERROR", text = "[page] a page's error" } } }, s.H);
        var r = await Http.Send(HttpMethod.Get, s.Base + "/api/diagnostics/zip", null, s.H);
        Assert.Equal(200, r.Status);
        Assert.Equal("application/zip", r.ContentHeaders.ContentType?.MediaType);
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/api/diagnostics/zip");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        var bytes = await (await Http.Client.SendAsync(req)).Content.ReadAsByteArrayAsync();
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(bytes));
        var names = zip.Entries.Select(e => e.FullName).ToArray();
        Assert.Contains("about.txt", names);
        Assert.Contains("MandarinServer_log.txt", names);
        Assert.Contains("Web/MandarinWeb_log.txt", names);
        using var about = new StreamReader(zip.GetEntry("about.txt")!.Open());
        Assert.Contains("# Mandarin Server ", about.ReadToEnd());
        using var server = new StreamReader(zip.GetEntry("MandarinServer_log.txt")!.Open());
        Assert.Contains("[auth] signed in", server.ReadToEnd());
    }

    [Test]
    public async Task The_apps_log_is_kept_under_the_phones_name()
    {
        await using var s = await Session.Started();
        var text = "2026-11-11 21:14:03.123 UTC  WARN   [NET] server GET /api/zones → HTTP 500 after 40 ms\n" +
                   "2026-11-11 21:14:04.000  4242  4250 W PhonePlayer: underrun, token=abcdef0123456789\n";
        Assert.Equal(2, (await s.Api("diagnostics/app", new { text })).J["kept"]!.GetValue<int>());
        // The phone's name is the device the sign-in made ("test"); what is the owner's alone taken out again.
        var kept = File.ReadAllText(Path.Combine(Logs(s), "Apps", "test.txt"));
        Assert.StartsWith("# The Mandarin app on test: its log", kept);
        Assert.Contains("[NET] server GET /api/zones → HTTP 500 after 40 ms\n", kept);
        Assert.Contains("PhonePlayer: underrun, token=[…]\n", kept);
        Assert.DoesNotContain("abcdef0123456789", kept);
        // Sent again later: added, the heading once.
        await s.Api("diagnostics/app", new { text = "2026-11-11 21:20:00.000 UTC  INFO   [APP] later\n" });
        kept = File.ReadAllText(Path.Combine(Logs(s), "Apps", "test.txt"));
        Assert.Single(Regex.Matches(kept, "^# ", RegexOptions.Multiline));
        Assert.EndsWith("[APP] later\n", kept);
        // Too much at once: refused, nothing kept.
        Assert.Equal(413, (await s.Api("diagnostics/app", new { text = new string('x', 600_000) })).Status);
        // In the zip, with the rest.
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/api/diagnostics/zip");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(await (await Http.Client.SendAsync(req)).Content.ReadAsByteArrayAsync()));
        Assert.Contains("Apps/test.txt", zip.Entries.Select(e => e.FullName));
    }
}
