using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The Node server's answers, recorded (v0.8.50) while it was still here, for the suites that held the
/// C# server to them: test/golden/&lt;name&gt;.json, read back step by step (test/golden.js, in C#).
/// </summary>
public static class Golden
{
    private static string File(string name) => Path.Combine(ServerProcess.Root, "test", "golden", name + ".json");

    /// <summary>
    /// The cases a parity suite asks, as data (test/golden/&lt;name&gt;.cases.json): the values its JavaScript
    /// made, written once as JSON.stringify wrote them into the jobs it sent.
    /// </summary>
    public static JsonObject Cases(string name) => JsJson.Parse(System.IO.File.ReadAllText(File(name + ".cases")))!.AsObject();

    /// <summary>
    /// The jobs a parity suite sent the program, as data (test/golden/&lt;name&gt;.jobs.json.gz): each one its
    /// JavaScript made and sent, kept once as it went, in the order it went. A year its JavaScript took
    /// from the clock is kept as "&lt;NEXT YY&gt;" and filled in again here (next year's last two digits).
    /// </summary>
    public static JsonArray Jobs(string name)
    {
        using var z = new System.IO.Compression.GZipStream(System.IO.File.OpenRead(File(name + ".jobs") + ".gz"), System.IO.Compression.CompressionMode.Decompress);
        using var reader = new StreamReader(z, System.Text.Encoding.UTF8);
        var text = reader.ReadToEnd().Replace("<NEXT YY>", ((DateTime.Now.Year + 1) % 100).ToString("00", System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);
        return JsJson.Parse(text)!.AsArray();
    }

    /// <summary>The program's rules asked with <paramref name="job"/> (`mandarin-server score`), read as JSON.parse reads.</summary>
    public static async Task<JsonNode> Score(JsonObject job)
    {
        var r = await ServerCommand.Run(["score"], stdin: JsJson.Stringify(job, markNegativeZero: false) + "\n");
        Assert.True(r.Code == 0, r.Err);
        var o = JsJson.Parse(r.Out.Split('\n')[0])!;
        Assert.True(o["error"] == null, o.Str("error"));
        return o;
    }

    /// <summary>Several jobs asked of the program at once, one a line: an answer each, in order.</summary>
    public static async Task<List<JsonNode>> ScoreMany(IEnumerable<JsonNode?> jobs)
    {
        var text = string.Concat(jobs.Select(j => JsJson.Stringify(j, markNegativeZero: false) + "\n"));
        var r = await ServerCommand.Run(["score"], stdin: text);
        Assert.True(r.Code == 0, r.Err);
        var lines = r.Out.Split('\n').Where(l => l.Length > 0).Select(l => JsJson.Parse(l)!).ToList();
        Assert.All(lines, l => Assert.True(l["error"] == null, l.Str("error")));
        return lines;
    }

    /// <summary>A recording of steps, each under its label, compared in order.</summary>
    public sealed class Recording(string name)
    {
        private JsonArray? list;
        private int at;
        private JsonArray Read() => list ??= JsJson.Parse(System.IO.File.ReadAllText(File(name)))!.AsArray();

        /// <summary>The next step, which must be the one under this label.</summary>
        public JsonNode? Peek(string label)
        {
            var g = at < Read().Count ? Read()[at] : null;
            Assert.True(g != null, "the recording ends before " + label);
            Assert.True(g.Str("label") == label, $"the recording in step: {g.Str("label")}, not {label}");
            return g["v"];
        }

        /// <summary>This step done.</summary>
        public void Kept(string label) => at++;

        /// <summary>The Node server's side of this step, as it was recorded.</summary>
        public JsonNode? Want(string label) { var v = Peek(label); Kept(label); return v; }

        /// <summary>Every step compared.</summary>
        public void Done() => Assert.True(at == Read().Count, "every recorded step compared");
    }

    /// <summary>A parity suite's kept answers: in full where they are few, else a short sum of each run of 32.</summary>
    public sealed class Answers
    {
        private const int Per = 32;
        private readonly string name;
        private readonly JsonObject answers, inputs;
        private readonly Dictionary<string, int> used = [];

        /// <summary>test/golden/<paramref name="name"/>.json.</summary>
        public Answers(string name)
        {
            this.name = name;
            var path = File(name);
            var book = System.IO.File.Exists(path) ? JsJson.Parse(System.IO.File.ReadAllText(path))!.AsObject() : [];
            answers = book["answers"]?.AsObject() ?? [];
            inputs = book["inputs"]?.AsObject() ?? [];
        }

        private string Key(string what)
        {
            int n = used.GetValueOrDefault(what) + 1;
            used[what] = n;
            return n > 1 ? $"{what} #{n}" : what;
        }

        private static string Sum(IEnumerable<JsonNode?> list) =>
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", list.Select(x => JsJson.Stringify(x))))))[..8];

        private static string Cut(string s, int n) => s.Length > n ? s[..n] : s;

        /// <summary>C#'s answers <paramref name="got"/> to <paramref name="cases"/>, each the Node server's answer as kept.</summary>
        public void Same(string what, IReadOnlyList<object?> labels, IReadOnlyList<JsonNode?> cases, IReadOnlyList<JsonNode?> got)
        {
            var k = Key(what);
            var g = answers[k];
            Assert.True(g != null, $"{k}: not in {name}.json");
            Assert.True(got.Count == g.Num("n"), k + ": as many answers as cases");
            string Show(int i) => $"case: {Cut(JsJson.Stringify(cases[i]), 1500)}\nc#:   {Cut(JsJson.Stringify(got[i]), 3000)}";
            if (g["all"] is JsonArray all)
            {
                for (int i = 0; i < got.Count; i++)
                    if (JsJson.Stringify(got[i]) != JsJson.Stringify(all[i]))
                        Assert.Fail($"{k} #{i} ({labels[i]}) differs from the Node server's\nnode: {Cut(JsJson.Stringify(all[i]), 3000)}\n{Show(i)}");
                return;
            }
            var sums = g.Str("sums")!;
            for (int c = 0; c * Per < got.Count; c++)
            {
                int from = c * Per, to = Math.Min(got.Count, from + Per);
                if (Sum(got.Skip(from).Take(to - from)) == sums.Substring(c * 8, 8)) continue;
                var lines = Enumerable.Range(from, to - from).Select(i => $"#{i} ({labels[i]})\n{Show(i)}");
                Assert.Fail($"{k}: cases {from} to {to - 1}, one or more, differ from the Node server's (kept as a sum)\n{Cut(string.Join("\n", lines), 12000)}");
            }
        }

        /// <summary>An input the Node server's module made for a case, as kept, whole.</summary>
        public JsonNode? Input(string label)
        {
            var k = Key("input: " + label);
            Assert.True(inputs.ContainsKey(k), $"{k}: not in {name}.json");
            return inputs[k]?.DeepClone();
        }

        /// <summary>Every kept answer asked for.</summary>
        public void Done()
        {
            var asked = new HashSet<string>();
            foreach (var (what, n) in used) for (int i = 1; i <= n; i++) asked.Add(i > 1 ? $"{what} #{i}" : what);
            var left = answers.Select(kv => kv.Key).Where(k => !asked.Contains(k)).ToList();
            Assert.True(left.Count == 0, "every kept answer compared; not: " + string.Join(", ", left));
        }
    }
}

/// <summary>
/// A class's book of kept answers (a class fixture: one for all its tests), every answer in it asked for
/// once the last test is done — where the server is built, as the tests then ran.
/// </summary>
public abstract class KeptBook(string name) : IDisposable
{
    /// <summary>The book.</summary>
    public Golden.Answers Kept { get; } = new(name);

    /// <inheritdoc/>
    public void Dispose()
    {
        GC.SuppressFinalize(this);
        if (ServerProcess.NotBuilt == null) Kept.Done();
    }
}
