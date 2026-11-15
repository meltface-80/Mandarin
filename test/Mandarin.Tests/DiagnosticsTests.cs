using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Mandarin's one log (item 425, Diagnostics.cs): every line of the server's, the Android app's, the page's and every
/// Bridge's in one plain-text file, &lt;data&gt;/Logs/Mandarin_log.txt, a line an event in the order they come, each
/// dated in UTC with its level and where it came from ("[server]", "[app Pixel 8]", "[web Mac · Chrome]"); at 8 MB it
/// rolls into Mandarin_log.01.txt and on, ten files at most, a file holding whole lines only. Each line is kept without
/// what is the owner's alone (their account's name, keys, internet and Tailscale addresses: LogScrubTests) but with what
/// helps (a home-network address, a device's name, item 235). On Mandarin OS (MANDARIN_LOG=journal) the server keeps no
/// file: its lines, scrubbed, go to standard output, which the OS writes into the one log (test/os-log.test.js).
/// </summary>
public sealed class DiagnosticsTests
{
    private static readonly Regex Line = new(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  (INFO |WARN |ERROR|DEBUG)  \[[^\]]+\] ", RegexOptions.Compiled);

    private static async Task WrongPassword(Session s)
    {
        try { await Session.SignIn(s.Base, password: "not the password", create: false); }
        catch (InvalidOperationException) { /* turned away, as meant */ }
    }

    private static string Logs(Session s) => Path.Combine(s.Lib.Data, "Logs");

    /* The one log as it is now: its files read oldest first. */
    private static string All(Session s) =>
        string.Concat(Directory.GetFiles(Logs(s), "Mandarin_log*.txt").OrderByDescending(f => f.EndsWith("_log.txt", StringComparison.Ordinal) ? 0 : int.Parse(f[^6..^4], CultureInfo.InvariantCulture)).Select(File.ReadAllText));

    private static string Stamp(DateTime t) => t.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);

    [Test]
    public async Task The_one_log_holds_the_servers_lines_saying_where_they_came_from_and_not_the_owners_own()
    {
        // An install from before: the server's own rolling log, the Bridges', the apps' and the page's, and older still.
        var lib = Fixtures.MakeLibrary();
        var old = Path.Combine(lib.Data, "Logs");
        foreach (var d in new[] { "Bridges", "Apps", "Web" }) Directory.CreateDirectory(Path.Combine(old, d));
        foreach (var f in new[] { "MandarinServer_log.txt", "MandarinServer_log.01.txt", "MandarinServer_before.txt", "Bridges/Kitchen.txt", "Apps/test.txt", "Web/MandarinWeb_log.txt" })
            File.WriteAllText(Path.Combine(old, f), "2026-11-01 10:00:00.000 UTC  INFO   [server] a line from before\n");
        File.WriteAllText(Path.Combine(lib.Data, "diagnostics-off"), "");
        File.WriteAllText(Path.Combine(lib.Data, "diagnostics.log"), "2026-11-01 10:00:00 [server] older still\n");
        await using var s = await Session.Started(lib: lib);
        await WrongPassword(s);
        await Session.SignIn(s.Base);

        // One file, and nothing of the logs from before.
        Assert.Equal(["Mandarin_log.txt"], Directory.GetFileSystemEntries(Logs(s)).Select(f => Path.GetFileName(f)!).ToArray());
        Assert.False(File.Exists(Path.Combine(lib.Data, "diagnostics-off")) || File.Exists(Path.Combine(lib.Data, "diagnostics.log")), "the old diagnostics files let go");
        var log = File.ReadAllText(Path.Combine(Logs(s), "Mandarin_log.txt"));
        Assert.DoesNotContain("from before", log);
        Assert.DoesNotContain("older still", log);
        // What the server is, as it starts; then each line dated in UTC with its level and "[server]"; the device's own
        // address and the device's name kept, the account's name nowhere.
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  INFO   \[server\] \[start\] Mandarin Server \S+ starting$", RegexOptions.Multiline), log);
        Assert.Contains("[server] [start] Installed as: native", log);
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  INFO   \[server\] \[auth\] wrong password from 127\.0\.0\.1$", RegexOptions.Multiline), log);
        Assert.Contains("[server] [auth] signed in: test (android) from 127.0.0.1", log);
        Assert.DoesNotContain(Session.User, log);
        // Every line one event, saying when, how bad and where from.
        foreach (var l in log.Split('\n', StringSplitOptions.RemoveEmptyEntries)) Assert.Matches(Line, l);
        // The routes that read, cleared and zipped the logs are gone: the log is read where it is kept.
        foreach (var p in new[] { "diagnostics", "diagnostics/log", "diagnostics/bridges", "diagnostics/logs.txt", "diagnostics/zip" })
            Assert.Equal(404, (await s.Api(p)).Status);
    }

    [Test]
    public async Task The_log_rolls_at_its_size_into_ten_files_of_whole_lines_none_lost_the_oldest_let_go()
    {
        // Files of 4,000 bytes, so a few hundred lines roll them past the ten kept.
        await using var s = await Session.Started(env: new Dictionary<string, string> { ["MANDARIN_LOG_BYTES"] = "4000" });
        var n = 0;
        async Task Send(int count)
        {
            for (var i = 0; i < count; i += 20)
            {
                var text = string.Concat(Enumerable.Range(0, 20).Select(_ => $"{Stamp(DateTime.UtcNow)} UTC  INFO   [APP] line #{++n:00000} of the test\n"));
                Assert.Equal(20, (await s.Api("diagnostics/app", new { text })).J["kept"]!.GetValue<int>());
            }
        }
        int[] Numbers(string text) => [.. Regex.Matches(text, @"line #(\d{5}) of").Select(m => int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture))];

        // Rolled a few times: every line there once, in order, each file whole lines and no bigger than it may be.
        await Send(160);
        Assert.True(File.Exists(Path.Combine(Logs(s), "Mandarin_log.02.txt")), "rolled more than once");
        Assert.Equal(Enumerable.Range(1, 160), Numbers(All(s)));
        foreach (var f in Directory.GetFiles(Logs(s)))
        {
            var t = File.ReadAllText(f);
            Assert.True(new FileInfo(f).Length <= 4000, f + " is " + new FileInfo(f).Length + " bytes");
            Assert.EndsWith("\n", t);
            foreach (var l in t.Split('\n', StringSplitOptions.RemoveEmptyEntries)) Assert.Matches(Line, l);
        }

        // Past ten files: the current and .01 to .09, no more; the newest lines all there, the oldest let go.
        await Send(600);
        var names = Directory.GetFiles(Logs(s)).Select(f => Path.GetFileName(f)!).Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(["Mandarin_log.01.txt", "Mandarin_log.02.txt", "Mandarin_log.03.txt", "Mandarin_log.04.txt", "Mandarin_log.05.txt",
            "Mandarin_log.06.txt", "Mandarin_log.07.txt", "Mandarin_log.08.txt", "Mandarin_log.09.txt", "Mandarin_log.txt"], names);
        var kept = Numbers(All(s));
        Assert.True(kept[0] > 1, "the oldest let go");
        Assert.Equal(Enumerable.Range(kept[0], 760 - kept[0] + 1), kept);
        Assert.Matches(new Regex(@"line #00760 of the test\n\z"), File.ReadAllText(Path.Combine(Logs(s), "Mandarin_log.txt")));
    }

    [Test]
    public async Task A_request_that_throws_is_in_the_log_with_why()
    {
        await using var s = await Session.Started();
        // A Bridge update asked for with a body that isn't JSON: the route reads it without a try, and throws.
        var r = await Http.Send(HttpMethod.Post, s.Base + "/api/update/bridges/apply", new StringContent("not json", System.Text.Encoding.UTF8, "application/json"), s.H);
        Assert.Equal(500, r.Status);
        await Session.Until(() => Task.FromResult(All(s).Contains("[aspnet]")), 5000, "ASP.NET's line");
        var log = All(s);
        Assert.Matches(new Regex(@"UTC  ERROR  \[server\] \[aspnet\] .*unhandled exception", RegexOptions.IgnoreCase), log);
        // Why, and where: the exception's own words and the server's frames of its stack, each a line of its own.
        Assert.True(log.Contains("JsonReaderException: 'not json' is an invalid JSON literal") && log.Contains("at Mandarin.Server."), log);
        Assert.Matches(new Regex(@"UTC  ERROR  \[server\]\s+at Mandarin\.Server\.", RegexOptions.Multiline), log);
    }

    [Test]
    public async Task The_pages_errors_go_into_the_one_log_scrubbed_and_held_to_a_few()
    {
        await using var s = await Session.Started();
        var h = new Dictionary<string, string>(s.H) { ["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };
        var lines = Enumerable.Range(0, 30).Select(i => new { level = "ERROR", text = $"[page] TypeError: x is undefined #{i} for owner@example.com" }).ToArray();
        var r = await Http.Post(s.Base + "/api/diagnostics/page", new { lines }, h);
        Assert.Equal(20, r.J["kept"]!.GetValue<int>());   // at most 20 a request
        var log = All(s);
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  ERROR  \[web Mac · Chrome\] \[page\] TypeError: x is undefined #0 for \[email\]$", RegexOptions.Multiline), log);
        Assert.DoesNotContain("owner@example.com", log);
        Assert.DoesNotContain("#20 ", log);
        // Not signed in: nothing kept.
        Assert.Equal(401, (await Http.Post(s.Base + "/api/diagnostics/page", new { lines }, null)).Status);
    }

    [Test]
    public async Task The_apps_lines_go_into_the_one_log_under_the_phones_name_when_they_were_said_scrubbed()
    {
        await using var s = await Session.Started();
        var text = "2026-11-11 21:14:03.123 UTC  WARN   [NET] server GET /api/zones → HTTP 500 after 40 ms from owner@example.com\n" +
                   "2026-11-11 21:14:04.000  4242  4250 W PhonePlayer: underrun, token=abcdef0123456789\n" +
                   "\tat com.musicd.PhonePlayer.feed(PhonePlayer.kt:42)\n";
        Assert.Equal(3, (await s.Api("diagnostics/app", new { text })).J["kept"]!.GetValue<int>());
        // The phone's name is the device the sign-in made ("test"); each line with the time and level it was said at, a
        // stack's line with the line before's; what is the owner's alone taken out again.
        var log = All(s);
        Assert.Contains("2026-11-11 21:14:03.123 UTC  WARN   [app test] [NET] server GET /api/zones → HTTP 500 after 40 ms from [email]\n", log);
        Assert.Contains("2026-11-11 21:14:04.000 UTC  WARN   [app test] PhonePlayer: underrun, token=[…]\n", log);
        Assert.Contains("2026-11-11 21:14:04.000 UTC  WARN   [app test] \tat com.musicd.PhonePlayer.feed(PhonePlayer.kt:42)\n", log);
        Assert.DoesNotContain("abcdef0123456789", log);
        Assert.DoesNotContain("owner@example.com", log);
        // Too much at once: refused, nothing kept.
        Assert.Equal(413, (await s.Api("diagnostics/app", new { text = new string('x', 600_000) })).Status);
        Assert.DoesNotContain("xxxxxxxxxx", All(s));
    }

    [Test]
    public async Task Lines_from_two_places_come_one_after_another_in_time_order()
    {
        await using var s = await Session.Started();
        // The app says a line, the server another (a wrong password), the app a third: in that order, each saying where.
        await s.Api("diagnostics/app", new { text = $"{Stamp(DateTime.UtcNow)} UTC  INFO   [APP] first, from the phone\n" });
        await WrongPassword(s);
        await s.Api("diagnostics/app", new { text = $"{Stamp(DateTime.UtcNow)} UTC  INFO   [APP] third, from the phone\n" });
        var lines = All(s).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        int At(string what) => Array.FindIndex(lines, l => l.Contains(what, StringComparison.Ordinal));
        var (a, b, c) = (At("[app test] [APP] first"), At("[server] [auth] wrong password"), At("[app test] [APP] third"));
        Assert.True(a >= 0 && a < b && b < c, $"{a} {b} {c}\n{string.Join('\n', lines)}");
        var times = lines.Skip(a).Take(c - a + 1).Select(l => l[..23]).ToArray();
        Assert.Equal(times.Order(StringComparer.Ordinal), times);
    }

    [Test]
    public async Task On_Mandarin_OS_the_server_keeps_no_file_and_says_each_line_scrubbed_on_its_standard_output()
    {
        await using var s = await Session.Started(env: new Dictionary<string, string> { ["MANDARIN_LOG"] = "journal" });
        await WrongPassword(s);
        await Session.SignIn(s.Base);
        await s.Api("diagnostics/app", new { text = "2026-11-11 21:14:03.123 UTC  WARN   [NET] token=abcdef0123456789\n" });
        Assert.False(Directory.Exists(Logs(s)) && Directory.EnumerateFileSystemEntries(Logs(s)).Any(), "no file of its own");
        var said = string.Join('\n', s.Server.Logs);
        Assert.Matches(new Regex(@"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC  INFO   \[server\] \[auth\] wrong password from 127\.0\.0\.1$", RegexOptions.Multiline), said);
        Assert.Contains("2026-11-11 21:14:03.123 UTC  WARN   [app test] [NET] token=[…]", said);
        // What Mandarin OS writes into the one log is the line as kept: the account's name nowhere.
        Assert.Contains("[server] [auth] signed in: test (android) from 127.0.0.1", said);
        Assert.DoesNotContain(Session.User, said);
        Assert.DoesNotContain("abcdef0123456789", said);
    }
}
