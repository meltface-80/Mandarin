// Program.cs — mandarin-audio, Mandarin's audio engine (v0.8.0).
//
//   mandarin-audio --version
//   mandarin-audio --device alsa:plughw:CARD=Mojo,DEV=0 [--ffmpeg PATH] [--core N] [--latency-ms 500]
//   mandarin-audio --device file:/tmp/out.raw          (the tests' device)
//
// The server (lib/local/engine.js) starts one per sound device and talks to it
// over stdin and stdout, one JSON object a line.
//
//   commands  {"cmd":"play","uri":"…","offset":12.5,"paused":false}
//             {"cmd":"next","uri":"…"}        the track after, gapless ("" clears it)
//             {"cmd":"pause"} {"cmd":"resume"} {"cmd":"stop"}
//             {"cmd":"gain","value":0.5}      linear, 1 = untouched
//             {"cmd":"quit"}
//   events    {"ev":"hello","version":"0.8.0","protocol":1}
//             {"ev":"pos","state":"PLAYING","uri":"…","seconds":12.8,"rate":96000,"channels":2,"ahead":41.2}
//             {"ev":"format","rate":96000,"channels":2}   the device opened at this format
//             {"ev":"decoded","uri":"…"}      a track's last sample is in the buffer
//             {"ev":"ended"}                  the queue played out
//             {"ev":"xrun","count":1}         the device ran dry (should never happen)
//             {"ev":"error","message":"…"}    words the page can show
//
// Logs go to stderr.
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Mandarin.Audio;

internal static class Program
{
    // The server's version, stamped by engine/build.sh (-p:Version).
    public static readonly string Version = (typeof(Program).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);
    public const int Protocol = 1;
    private static readonly object outLock = new();

    private static int Main(string[] args)
    {
        string? device = null, ffmpeg = "ffmpeg";
        int core = -1;
        uint latencyMs = 500;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--version": Console.WriteLine(Version + " protocol " + Protocol); return 0;
                case "--device": device = Arg(args, ref i); break;
                case "--ffmpeg": ffmpeg = Arg(args, ref i); break;
                case "--core": core = int.Parse(Arg(args, ref i), CultureInfo.InvariantCulture); break;
                case "--latency-ms": latencyMs = uint.Parse(Arg(args, ref i), CultureInfo.InvariantCulture); break;
                default: Console.Error.WriteLine("unknown argument " + args[i]); return 2;
            }
        }
        if (device == null) { Console.Error.WriteLine("--device is required"); return 2; }

        ISink sink;
        if (device.StartsWith("alsa:", StringComparison.Ordinal))
        {
            if (!Alsa.Available()) { Emit(Json.Obj("ev", "error", "message", "this computer has no ALSA (libasound.so.2)")); return 3; }
            sink = new AlsaSink(device[5..], latencyMs * 1000);
        }
        else if (device.StartsWith("file:", StringComparison.Ordinal)) sink = new FileSink(device[5..]);
        else { Console.Error.WriteLine("unknown device " + device); return 2; }

        System.Runtime.GCSettings.LatencyMode = System.Runtime.GCLatencyMode.SustainedLowLatency;
        var engine = new Engine(sink, ffmpeg!, core, Emit, Log);
        Emit(Json.Obj("ev", "hello", "version", Version, "protocol", Protocol));

        // Commands, until stdin closes (the server went away) or "quit".
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var c = doc.RootElement;
                switch (Str(c, "cmd"))
                {
                    case "play": engine.Play(Str(c, "uri"), Num(c, "offset"), Bool(c, "paused")); break;
                    case "next": engine.Next(Str(c, "uri")); break;
                    case "pause": engine.Pause(); break;
                    case "resume": engine.Resume(); break;
                    case "stop": engine.Stop(); break;
                    case "gain": engine.SetGain(c.TryGetProperty("value", out var v) ? v.GetDouble() : 1); break;
                    case "quit": engine.Stop(); sink.Dispose(); return 0;
                    default: Log("unknown command: " + line); break;
                }
            }
            catch (Exception e) { Log("bad command (" + e.Message + "): " + line); }
        }
        engine.Stop();
        sink.Dispose();
        return 0;
    }

    private static string Arg(string[] a, ref int i) => ++i < a.Length ? a[i] : throw new ArgumentException(a[i - 1] + " needs a value");
    private static string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
    private static double Num(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
    private static bool Bool(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;

    public static void Emit(string json)
    {
        lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }

    public static void Log(string s)
    {
        lock (outLock) { Console.Error.WriteLine(s); Console.Error.Flush(); }
    }
}

// One JSON object from name/value pairs (strings, numbers, booleans). No
// reflection, so the program builds ahead of time without warnings.
internal static class Json
{
    public static string Obj(params object?[] kv)
    {
        var sb = new StringBuilder("{");
        for (int i = 0; i + 1 < kv.Length; i += 2)
        {
            if (i > 0) sb.Append(',');
            Str(sb, (string)kv[i]!);
            sb.Append(':');
            switch (kv[i + 1])
            {
                case null: sb.Append("null"); break;
                case string s: Str(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d: sb.Append(double.IsFinite(d) ? d.ToString("R", CultureInfo.InvariantCulture) : "0"); break;
                case float f: sb.Append(float.IsFinite(f) ? f.ToString("R", CultureInfo.InvariantCulture) : "0"); break;
                case IFormattable n: sb.Append(n.ToString(null, CultureInfo.InvariantCulture)); break;
                default: Str(sb, kv[i + 1]!.ToString() ?? ""); break;
            }
        }
        return sb.Append('}').ToString();
    }

    private static void Str(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (char ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(ch);
                    break;
            }
        }
        sb.Append('"');
    }
}
