// Program.cs — mandarin-server, Mandarin's server in C# (v0.8.1 on).
//
// The front door. It listens on Mandarin's port (PORT, 3500), answers what
// has been moved to C#, and passes everything else, as it came, to the Node
// server behind it: started here (`node launcher.js`, so in-app updates work
// as before) on a free port on 127.0.0.1 that nothing else can reach. As each
// part of the server moves to C#, less goes through; when nothing does, Node
// is gone. See server/README.md.
//
//   PORT                 the port Mandarin is reached on (3500)
//   MANDARIN_UPSTREAM    a Node server already running (the tests'), instead
//                        of starting one: http://127.0.0.1:<port>
//   MANDARIN_APP_DIR     where index.js and launcher.js are (found by itself)
//   NODE_BIN             the node to run (node)
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Mandarin.Server;

var version = (typeof(Front).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);

// `mandarin-server --srp-vector test/srp-vector.json`: the server's half of
// SRP against the fixed example the page and the Android app are checked
// against too (test/srp.test.js).
if (args.Length == 2 && args[0] == "--srp-vector")
{
    var v = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(args[1]))!;
    var st = Srp.ServerStart((string)v["verifier"]!, (string)v["b"]!);
    var res = Srp.ServerVerify(st, (string)v["A"]!, (string)v["M1"]!);
    var bad = Srp.ServerVerify(st, (string)v["A"]!, new string('0', 64));
    Console.WriteLine(new System.Text.Json.Nodes.JsonObject { ["B"] = st.B, ["ok"] = res.Ok, ["M2"] = res.M2, ["wrong_ok"] = bad.Ok }.ToJsonString());
    return 0;
}
// `mandarin-server tags <file>…`: what the scanner reads from each file, one
// line of JSON each (Tags/TagReader.cs) — the same as /internal/tags gives.
if (args.Length >= 1 && args[0] == "tags")
{
    var paths = args.Length > 1 ? args[1..] : Console.In.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);
    foreach (var path in paths) Console.WriteLine(Mandarin.Server.Tags.TagReader.Line(path));
    return 0;
}
// `mandarin-server scan`: one library scan (Scan/ScanCommand.cs), started by
// the Node server: its job on standard input, what it says on standard output.
if (args.Length >= 1 && args[0] == "scan") return Mandarin.Server.Scan.ScanCommand.Run();
// `mandarin-server score`: the identification scan's scorer asked directly, a
// line of JSON in and one out (Identify/ScoreCommand.cs), for the tests.
if (args.Length >= 1 && args[0] == "score") return Mandarin.Server.Identify.ScoreCommand.Run();
// `mandarin-server waveform <file> [seconds]`: a file's waveform as /api/waveform keeps it (Waveforms.cs).
if (args.Length >= 2 && args[0] == "waveform")
{
    var peaks = await Waveforms.Decode(args[1], args.Length > 2 && double.TryParse(args[2], System.Globalization.CultureInfo.InvariantCulture, out var secs) ? secs : 0);
    Console.WriteLine(peaks == null ? "null" : Convert.ToBase64String(peaks));
    return peaks == null ? 1 : 0;
}
int port = int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var p) && p > 0 ? p : 3500;
string? upstream = Environment.GetEnvironmentVariable("MANDARIN_UPSTREAM");

// The key this server asks the Node server's private addresses with
// (/internal/library): given to the Node server it starts, or by the tests.
string frontKey = Environment.GetEnvironmentVariable("MANDARIN_FRONT_KEY") is { Length: > 0 } fk ? fk
    : Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
Process? node = null;
if (string.IsNullOrEmpty(upstream))
{
    int internalPort = Front.FreeLoopbackPort();
    string appDir = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir();
    node = Front.StartNode(appDir, internalPort, frontKey, port);
    upstream = $"http://127.0.0.1:{internalPort}";
}
var upstreamUri = new Uri(upstream);
// The database the Node server keeps (lib/library/db.js), shared: the Node
// server makes it and brings its tables up to date before this one reads it.
string dataDir = Environment.GetEnvironmentVariable("DATA_DIR") is { Length: > 0 } dd ? dd
    : Path.Combine(Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir(), "data");
Db.File = Path.Combine(dataDir, "musicd.db");
Library.Init(upstreamUri, frontKey);
Transcoder.Init(dataDir);
Downloads.Init(dataDir);
Front.Log($"[server] Mandarin's server {version} (C#) on port {port}; the Node server behind it at {upstream}");

// Nothing is answered until the Node server is: a request that arrived first
// would only be refused.
Front.Log("[server] waiting for the Node server");
if (!await Front.WaitForUpstream(upstreamUri, node, TimeSpan.FromMinutes(5)))
{
    Front.Log("[server] the Node server didn't start; stopping");
    return node?.HasExited == true ? node.ExitCode : 1;
}

Front.Log("[server] the Node server is up");
// The identification scan, the MusicBrainz pack and loudness measuring, taken
// over from the Node server (Jobs.cs) before anything is answered.
await Jobs.Start(upstreamUri, frontKey, port, dataDir, version);
// No settings files, so nothing to watch: by default ASP.NET watches its
// start folder and everything under it for appsettings.json, which from /app
// (node_modules and all) held the start for minutes.
Environment.SetEnvironmentVariable("DOTNET_hostBuilder__reloadConfigOnChange", "false");
var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(k =>
{
    k.AddServerHeader = false;
    k.Limits.MaxRequestBodySize = null;              // a whole database, restored from a backup
    k.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);
    k.Limits.MinRequestBodyDataRate = null;          // a phone on mobile data, uploading slowly
    k.Limits.MinResponseDataRate = null;             // a renderer reading a stream at its own pace
    // A backup's description names the device it was made on ("iPhone · Safari",
    // AdminRoutes.cs): one byte a character, as the Node server writes a header,
    // where Kestrel would otherwise refuse anything past ASCII.
    k.ResponseHeaderEncodingSelector = name => name.Equals("X-Mandarin-Backup", StringComparison.OrdinalIgnoreCase) ? System.Text.Encoding.Latin1 : null;
    k.Listen(IPAddress.Any, port);
});
builder.Services.AddHttpForwarder();
// gzip, as the Node server's compression() did for everything it answered:
// what the Node server answers comes through already compressed, and only
// text is (never audio, never a stream of events).
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
});
// Stopping (the Node server gone, or asked to): within two seconds, not the
// usual thirty; with nothing behind it, every request held open is a 502.
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(2));
var app = builder.Build();

app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Mandarin-Server"] = "C# " + version;
    await next();
});
app.UseResponseCompression();

// The Node server's "make these next" for the conversions made here (Transcoder.cs).
Transcoder.UseInternal(app);
// The Node server's check of this side's tag reader against its own (Tags/TagReader.cs).
Mandarin.Server.Tags.TagReader.UseInternal(app);
// The Node server's requests to MusicBrainz, each waiting its turn on the one timer here (Identify/Lookups.cs).
Mandarin.Server.Identify.Lookups.UseInternal(app);
// The Node server's word that a library scan has ended: what follows it is made here (Jobs.cs).
Jobs.UseInternal(app);

// The gate (Auth.cs): nothing but the sign-in page and its parts until the
// account exists and the device has signed in.
app.Use((ctx, next) => Auth.Gate(ctx, () => next(ctx)));

// The page and its files (Pages.cs), behind the gate as before.
Pages.Use(app, Path.Combine(Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir(), "public"));
// The library (Library.cs): read here, from the copy the Node server holds.
Library.Use(app);
// Covers and label logos already drawn (Images.cs); the rest are drawn by the Node server.
Images.Use(app, dataDir);
// Music files sent as they are (Streams.cs); conversions are the Node server's.
Streams.Use(app, dataDir);
// The phone's downloads and its Opus away from home (Downloads.cs).
Downloads.Use(app);
// Routes are chosen only after that: the static files step aside for any
// request a route has already matched, and the catch-all below matches all.
app.UseRouting();

// What C# answers itself. Everything else goes to the Node server.
Routes.Map(app, version);
Auth.Map(app);

var invoker = Front.Invoker();
var transformer = new ForwardTransformer();
var requestConfig = new Yarp.ReverseProxy.Forwarder.ForwarderRequestConfig
{
    // A stream to a renderer, a held request: as long as they last.
    ActivityTimeout = TimeSpan.FromHours(6),
};
app.MapForwarder("/{**catch-all}", upstream, requestConfig, transformer, invoker);

// The Node server stopping (Shut down, a crash) stops this too, with its
// code, so Docker's restart policy and the Mac's login item act as before.
if (node != null)
{
    var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
    node.EnableRaisingEvents = true;
    node.Exited += (_, _) =>
    {
        Front.Log($"[server] the Node server stopped (code {node.ExitCode}); stopping");
        Environment.ExitCode = node.ExitCode;
        lifetime.StopApplication();
    };
    lifetime.ApplicationStopping.Register(() => Front.StopNode(node));
}

app.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping.Register(Jobs.Stop);
await app.StartAsync();
Front.Log($"[server] listening on port {port}");
await app.WaitForShutdownAsync();
return Environment.ExitCode;
