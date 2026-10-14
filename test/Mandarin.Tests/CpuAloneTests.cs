using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The processor shared out, playback first, by the program alone (v0.8.50; Cpu.cs): the cores
/// playback keeps, decided from the cores the program may use when it starts and PLAYBACK_CORES /
/// PLAYBACK_CORE, as lib/cpu.js decided it (its rule kept here); every thread of the program moved to
/// the rest; a DSP conversion given playback's second core, held a while after it ends, then given
/// back, the threads moving each time. Run for real where Linux's taskset is, the program started on as
/// many cores as each case wants (taskset -c); where it isn't, nothing is split, and a DSP conversion
/// is still told (test/cpu-alone.test.js, in C#).
/// </summary>
public sealed partial class CpuAloneTests
{
    [GeneratedRegex(@"Cpus_allowed_list:\s*(\S+)")] private static partial Regex Allowed();

    private static List<int> Expand(string list) => [.. list.Split(',').SelectMany(r =>
    {
        var p = r.Split('-').Select(int.Parse).ToArray();
        return p.Length == 1 ? [p[0]] : Enumerable.Range(p[0], p[1] - p[0] + 1);
    })];

    private static string Compact(IReadOnlyList<int> cores)
    {
        var o = new List<string>();
        for (int i = 0; i < cores.Count; i++)
        {
            int j = i;
            while (j + 1 < cores.Count && cores[j + 1] == cores[j] + 1) j++;
            o.Add(j > i ? $"{cores[i]}-{cores[j]}" : cores[i].ToString(System.Globalization.CultureInfo.InvariantCulture));
            i = j;
        }
        return string.Join(",", o);
    }

    private static string? AllowedOf(string status) => Allowed().Match(status) is { Success: true } m ? m.Groups[1].Value : null;

    private static List<string> ThreadsOf(int pid) => [.. Directory.GetDirectories($"/proc/{pid}/task").Select(t =>
    {
        try { return AllowedOf(File.ReadAllText(Path.Combine(t, "status"))); } catch (IOException) { return null; }
    }).OfType<string>()];

    private static readonly Lazy<List<int>> Mine = new(() => OperatingSystem.IsLinux() ? Expand(AllowedOf(File.ReadAllText("/proc/self/status"))!) : []);

    private static void NeedReal()
    {
        Needs.Server();
        if (!HaveTaskset()) Assert.Skip("no taskset here");
        if (Mine.Value.Count < 4) Assert.Skip("fewer than four cores here");
    }

    private static bool HaveTaskset()
    {
        if (!OperatingSystem.IsLinux()) return false;
        try { using var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("taskset", "--version") { RedirectStandardOutput = true, RedirectStandardError = true })!; p.WaitForExit(); return p.ExitCode == 0; }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }

    /// <summary>lib/cpu.js's decide, kept: playback's cores from the cores given, the settings and whether DSP is in use.</summary>
    private static string Decide(IReadOnlyList<int> cores, IReadOnlyDictionary<string, string>? env = null, bool dsp = false)
    {
        env ??= new Dictionary<string, string>();
        string Shape(bool split, IEnumerable<int> playback, IEnumerable<int> background, int? core) =>
            Http.Json(new { split, cores, playback, background, core });
        string? Get(string k) => env.TryGetValue(k, out var v) ? v : null;
        if (Get("PLAYBACK_CORES") == "0" || Get("PLAYBACK_CORE") == "0") return Shape(false, [], cores, null);
        int n = cores.Count;
        double? fixedN = Get("PLAYBACK_CORES") is { Length: > 0 } f && double.TryParse(f, out var fv) ? Math.Floor(fv) : null;
        double? asked = Get("PLAYBACK_CORE") is { Length: > 0 } a && double.TryParse(a, out var av) ? av : null;
        bool chosen = fixedN != null || asked != null;
        if (n < 2 || (n < 3 && !chosen)) return Shape(false, [], cores, null);
        int want = fixedN is > 0 ? (int)fixedN.Value : dsp ? 2 : 1;
        want = Math.Max(1, Math.Min(want, chosen || n < 4 ? n - 1 : n - 2));
        var playback = new List<int>();
        if (asked != null) playback.Add(cores.Contains((int)asked.Value) && asked == Math.Floor(asked.Value) ? (int)asked.Value : cores[n - 1]);
        for (int i = n - 1; i >= 0 && playback.Count < want; i--) if (!playback.Contains(cores[i])) playback.Add(cores[i]);
        int core = playback[0];
        playback.Sort();
        return Shape(true, playback, cores.Where(c => !playback.Contains(c)), core);
    }

    private static IEnumerable<int> Background(string decided) => JsonNode.Parse(decided)!["background"]!.AsArray().Select(x => x!.GetValue<int>());

    private sealed record Server(ServerProcess Proc, Dictionary<string, string> H, Fixtures.Library Lib) : IAsyncDisposable
    {
        public async Task<JsonNode> Cpu()
        {
            var r = await Http.Get(Proc.Base + "/api/cpu", H);
            Assert.Equal("C#", r.Header("x-mandarin-answered"));
            return r.J;
        }
        public async ValueTask DisposeAsync() => await Proc.Stop();
    }

    // The program started on cores (taskset -c), with env: its plan, and its process to look at.
    private static async Task<Server> Start(IReadOnlyList<int>? cores = null, Dictionary<string, string>? env = null)
    {
        var lib = Fixtures.MakeLibrary();
        string? bin = null;
        if (cores != null)
        {
            bin = Path.Combine(Directory.CreateTempSubdirectory("musicd-cpu-bin-").FullName, "mandarin-server");
            await File.WriteAllTextAsync(bin, $"#!/bin/sh\nexec taskset -c {Compact(cores)} \"{ServerProcess.Bin}\" \"$@\"\n");
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(bin, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }
        var e = new Dictionary<string, string> { ["PLAYBACK_CORES"] = "", ["PLAYBACK_CORE"] = "" };
        foreach (var (k, v) in env ?? []) e[k] = v;
        var srv = await ServerProcess.Start(Ports.Port(), lib.Music, lib.Data, e, bin);
        return new Server(srv, new() { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) }, lib);
    }

    private static string Shape(JsonNode p) => Http.Json(new { split = p["split"]?.DeepClone(), cores = p["cores"]?.DeepClone(), playback = p["playback"]?.DeepClone(), background = p["background"]?.DeepClone(), core = p["core"]?.DeepClone() });

    [Test]
    public async Task Playbacks_cores_as_lib_cpu_js_decided_them_for_the_cores_the_program_starts_on_and_the_settings()
    {
        NeedReal();
        var mine = Mine.Value;
        var four = mine.Take(4).ToList();
        (string What, List<int> Cores, Dictionary<string, string> Env)[] cases =
        [
            ("four cores: one for playback, three for the rest", four, []),
            ("eight or all this machine has", [.. mine.Take(Math.Min(8, mine.Count))], []),
            ("three cores", [.. mine.Take(3)], []),
            ("two cores: shared", [.. mine.Take(2)], []),
            ("two cores, a core asked for: even on two", [.. mine.Take(2)], new() { ["PLAYBACK_CORE"] = mine[1].ToString(System.Globalization.CultureInfo.InvariantCulture) }),
            ("a core chosen", four, new() { ["PLAYBACK_CORE"] = four[1].ToString(System.Globalization.CultureInfo.InvariantCulture) }),
            ("a core the machine hasn't: the last", four, new() { ["PLAYBACK_CORE"] = "99" }),
            ("PLAYBACK_CORE=0 turns it off", four, new() { ["PLAYBACK_CORE"] = "0" }),
            ("PLAYBACK_CORES=0 turns it off", four, new() { ["PLAYBACK_CORES"] = "0" }),
            ("two always", four, new() { ["PLAYBACK_CORES"] = "2" }),
            ("never every core", four, new() { ["PLAYBACK_CORES"] = "9" })
        ];
        foreach (var (what, cores, env) in cases)
        {
            await using var s = await Start(cores, env);
            var want = Decide(cores, env);
            JsonAssert.Same(want, JsonNode.Parse(Shape(await s.Cpu())), what);
            // Every thread of the program on the rest (none moved where nothing is split).
            var rest = Compact([.. Background(want)]);
            await Session.Until(() => Task.FromResult(ThreadsOf(s.Proc.Proc.Id).All(x => x == rest)), 15000, what + ": the program on the rest");
        }
    }

    // A zone with DSP, and a hi-res track to convert for it: a conversion with DSP asked for (`?o=`).
    private static async Task<Func<Task>> DspConversion(Server s)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        using (var db = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + Path.Combine(s.Lib.Data, "musicd.db") + ";Pooling=False"))
        {
            db.Open();
            using var c = db.CreateCommand();
            c.CommandText = "INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES('UPNP_cpu-dsp', 'upnp', 'DSP', $n, $n)";
            c.Parameters.AddWithValue("$n", now);
            c.ExecuteNonQuery();
        }
        var set = await Http.Send(HttpMethod.Patch, s.Proc.Base + "/api/audio-devices/UPNP_cpu-dsp",
            new StringContent(Http.Json(new { dsp = new { enabled = true, peq = new { bands = new[] { new { type = "peak", freq = 1000, gain = 4, q = 1.2 } } } } }), System.Text.Encoding.UTF8, "application/json"), s.H);
        Assert.True(set.Status == 200, set.Text);
        JsonNode? hi = null;
        await Session.Until(async () =>
        {
            var albums = (await Http.Get(s.Proc.Base + "/api/library/albums?sort=album", s.H)).J["albums"].Items().ToList();
            hi = albums.Count >= 3 ? albums.First(a => a.Str("title") == "Hi Res") : null;
            return hi != null;
        }, 30000, "the library");
        var page = (await Http.Get(s.Proc.Base + "/api/album?offset=" + hi.Num("offset"), s.H)).J;
        var trackId = page["tracks"]![0].Num("track_id");
        return async () =>
        {
            var r = await Bytes.Get($"{s.Proc.Base}/stream/t{trackId}.48000-24.flac?o=UPNP_cpu-dsp&n={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}", s.H);
            Assert.Equal(200, r.Status);
        };
    }

    [Test]
    public async Task A_DSP_conversion_playbacks_second_core_held_a_while_after_it_ends_then_given_back_the_program_moving_each_time()
    {
        NeedReal();
        var cores = Mine.Value.Take(4).ToList();
        await using var s = await Start(cores, new() { ["MANDARIN_CPU_HOLD_MS"] = "4000" });
        string plain = Decide(cores), withDsp = Decide(cores, dsp: true);
        var first = await s.Cpu();
        JsonAssert.Same(plain, JsonNode.Parse(Shape(first)));
        Assert.False(first.Bool("dsp"));
        var convert = await DspConversion(s);
        await convert();
        // Held after it ends: the split with DSP, and the program moved off playback's two cores.
        JsonNode? p = null;
        await Session.Until(async () => (p = await s.Cpu()).Bool("dsp") == true, 5000, "the split with DSP");
        JsonAssert.Same(withDsp, JsonNode.Parse(Shape(p!)), "with DSP: two for playback");
        await Session.Until(() => Task.FromResult(ThreadsOf(s.Proc.Proc.Id).All(x => x == Compact([.. Background(withDsp)]))), 15000, "the program moved for DSP");
        // Then given back once the hold is over; the program back on the rest.
        JsonNode? back = null;
        await Session.Until(async () => (back = await s.Cpu()).Bool("dsp") == false, 15000, "the second core given back");
        JsonAssert.Same(plain, JsonNode.Parse(Shape(back!)));
        await Session.Until(() => Task.FromResult(ThreadsOf(s.Proc.Proc.Id).All(x => x == Compact([.. Background(plain)]))), 15000, "the program back on the rest");
    }

    [Test]
    public async Task Nothing_to_split_the_program_still_says_when_DSP_is_in_use()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Start(env: new() { ["PLAYBACK_CORES"] = "0", ["MANDARIN_CPU_HOLD_MS"] = "1500" });
        var p = await s.Cpu();
        Assert.True(p.Bool("split") == false && !p["playback"].Items().Any() && p.Bool("dsp") == false, "nothing split, no DSP: " + p.ToJsonString());
        var convert = await DspConversion(s);
        await convert();
        await Session.Until(async () => (await s.Cpu()).Bool("dsp") == true, 5000, "DSP in use");
        Assert.True((await s.Cpu()).Bool("split") == false, "still nothing split");
        await Session.Until(async () => (await s.Cpu()).Bool("dsp") == false, 10000, "and no longer, once the hold is over");
    }
}
