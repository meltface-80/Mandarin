// ScanCommand.cs — `mandarin-server scan` (v0.8.18): one library scan, as a
// process of its own, started by the Node server where it used to start its
// scan thread (lib/library/scanner.js, scanByProgram). It is put on the cores
// playback doesn't keep, at the lowest priority, its reads last (lib/cpu.js).
//
// The job comes on standard input, as JSON: { dataDir, root, roots,
// massRemoval, force, slots }. What it says goes to standard output, a line of
// JSON each, as the scan thread said it: { type: "log", line }, { type:
// "state", state } every half second, { type: "progress", state } when albums
// have landed, then { type: "result", result, state } or { type: "error",
// message }. Nothing else is written there: anything else said goes to the log.
using System.Text;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Scan;

// The tag reader's JavaScript, not Mandarin.Server's JSON helpers of the same name.
using Js = Mandarin.Server.Tags.Js;

internal static class ScanCommand
{
    // The protocol this program speaks, said to the Node server it starts (Front.cs): the Node server checks it.
    public const string Protocol = "1";

    private static readonly object WriteLock = new();
    private static Stream? output;

    private static void Send(JsObj m)
    {
        var bytes = Encoding.UTF8.GetBytes(Js.Json(m) + "\n");
        lock (WriteLock)
        {
            try
            {
                var o = output!;
                o.Write(bytes);
                o.Flush();
            }
            catch (IOException)
            {
                // The Node server is gone: so is this scan (what it was writing is rolled back).
                Environment.Exit(3);
            }
        }
    }

    private static JsObj Message(string type, params (string, object?)[] fields)
    {
        var m = new JsObj();
        m["type"] = type;
        foreach (var (k, v) in fields) m[k] = v;
        return m;
    }

    public static int Run()
    {
        output = Console.OpenStandardOutput();
        // Anything else written goes to the log, never among the messages.
        Console.SetOut(Console.Error);
        Cpu.LowerThisThread();
        try
        {
            if (JsJson.Parse(Console.In.ReadToEnd()) is not JsObj job) throw new JsError("the scan's job is not an object");
            var dataDir = Js.Str(job["dataDir"]);
            var root = Js.Str(job["root"]);
            var roots = job["roots"] is List<object?> rl ? rl.Where(x => x is string).Select(x => (string)x!).ToList() : [root];
            var massRemoval = job["massRemoval"] is double mr ? mr : 500;
            var force = Js.Truthy(job["force"]);
            var slots = job["slots"] is double sl && sl >= 1 ? (int)Math.Min(sl, 64) : Math.Max(1, Environment.ProcessorCount - 1);

            using var db = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = Path.Combine(dataDir, "musicd.db"), Mode = SqliteOpenMode.ReadWrite, Pooling = false, DefaultTimeout = 60
            }.ToString());
            db.Open();
            using (var cmd = db.CreateCommand())
            {
                // As lib/library/db.js opens it: a write waits its turn, deleting a track takes its tags and loudness with it.
                cmd.CommandText = "PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;";
                cmd.ExecuteNonQuery();
            }
            var scanner = new Scanner(db, root, roots, massRemoval, slots, line => Send(Message("log", ("line", line))));
            scanner.OnProgress = () => Send(Message("progress", ("state", scanner.State.ToJs())));
            tick = new Timer(_ => Send(Message("state", ("state", scanner.State.ToJs()))), null, 500, 500);
            var result = scanner.Scan(force);
            StopTicking();
            Send(Message("result", ("result", result), ("state", scanner.State.ToJs())));
            return 0;
        }
        catch (Exception e)
        {
            StopTicking();
            Send(Message("error", ("message", e is JsError || e is SqliteException ? e.Message : e.GetType().Name + ": " + e.Message)));
            Console.Error.WriteLine(e.ToString());
            return 1;
        }
    }

    private static Timer? tick;

    /* The half-second state stopped, and any under way finished: nothing is said after the result (a "running" then would hold the next scan back). */
    private static void StopTicking()
    {
        var t = Interlocked.Exchange(ref tick, null);
        if (t == null) return;
        using var stopped = new ManualResetEvent(false);
        if (t.Dispose(stopped)) stopped.WaitOne();
    }
}
