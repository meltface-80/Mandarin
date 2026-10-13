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
using System.Runtime.InteropServices;
using Mandarin.Server;

// On a Mac (v0.8.29) the C library is libSystem: what this program imports as
// "libc" (the scan's file system, starting itself again, the pack's checks).
if (OperatingSystem.IsMacOS())
    NativeLibrary.SetDllImportResolver(typeof(Front).Assembly, (name, _, _) =>
        name == "libc" ? NativeLibrary.Load("/usr/lib/libSystem.B.dylib") : IntPtr.Zero);

var version = (typeof(Front).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);
Front.Version = version;

// `mandarin-server --version`: this program's version, and nothing else — how
// the Node server checks a newer one before putting it in place (v0.8.25,
// lib/server/csharp-update.js).
if (args.Length == 1 && args[0] == "--version")
{
    Console.WriteLine(version);
    return 0;
}

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
// `mandarin-server db <data folder>`: the database made, or brought up to date
// (Schema.cs, v0.8.48): run by the Node server as it opens it behind this one.
if (args.Length == 2 && args[0] == "db") return Schema.Command(args[1]);
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
// The database, shared with the Node server (<data>/musicd.db). Made and
// brought up to date here (Schema.cs, v0.8.48) before the Node server starts;
// the Node server asks this program again as it opens it (a backup put back
// is swapped in then). Before v0.8.48 the Node server made it.
string dataDir = Environment.GetEnvironmentVariable("DATA_DIR") is { Length: > 0 } dd ? dd
    : Path.Combine(Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir(), "data");
// `mandarin-server config`: what this server would be set up with, from the
// environment (Config.cs, v0.8.50), as the hand-over carried it — for the tests.
if (args.Length == 1 && args[0] == "config")
{
    try { Console.WriteLine(Config.FromEnvironment(dataDir, port).ToJsonString()); return 0; }
    catch (InvalidOperationException e) { Console.Error.WriteLine(e.Message); return 2; }
}
Db.File = Path.Combine(dataDir, "musicd.db");
Front.DataDir = dataDir;
string appDir = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir();
// No Node server behind this one (v0.8.50, stage 7): said (MANDARIN_NODE=0),
// or none there to start (no index.js in the app's folder). Everything is this
// server's from the start, set up from the environment (Config.cs).
bool alone = Environment.GetEnvironmentVariable("MANDARIN_NODE") == "0" || (string.IsNullOrEmpty(upstream) && !File.Exists(Path.Combine(appDir, "index.js")));
Process? node = null;
if (alone || string.IsNullOrEmpty(upstream))
{
    // A database put back from a backup goes in now, before it opens (Admin/Restore.cs).
    if (alone) Mandarin.Server.Admin.Backup.SwapStaged(dataDir, Front.Log);
    try { Schema.Bring(dataDir, Front.Log); }
    catch (Exception e) when (e is Microsoft.Data.Sqlite.SqliteException or IOException or UnauthorizedAccessException)
    {
        if (alone) { Front.Log($"[server] the database couldn't be brought up to date ({e.Message}); stopping"); return 1; }
        // Left to the Node server, which tries again (its own code, should this program's fail there too).
        Front.Log($"[server] the database couldn't be brought up to date here ({e.Message}); the Node server tries");
    }
}
System.Text.Json.Nodes.JsonObject? ownConfig = null;
if (alone)
{
    Front.Alone = true;
    try { ownConfig = Config.FromEnvironment(dataDir, port); }
    catch (InvalidOperationException e) { Front.Log("[server] " + e.Message + "; stopping"); return 2; }
}
else if (string.IsNullOrEmpty(upstream))
{
    int internalPort = Front.FreeLoopbackPort();
    node = Front.StartNode(appDir, internalPort, frontKey, port);
    upstream = $"http://127.0.0.1:{internalPort}";
}
var upstreamUri = alone ? null : new Uri(upstream!);
if (alone) Library.InitAlone(frontKey, ownConfig!["server_ip"]?.GetValue<string>(), port); else Library.Init(upstreamUri, frontKey);
Transcoder.Init(dataDir);
Downloads.Init(dataDir);
if (alone) Front.Log($"[server] Mandarin's server {version} (C#) on port {port}, on its own");
else
{
    Front.Log($"[server] Mandarin's server {version} (C#) on port {port}; the Node server behind it at {upstream}");
    // Nothing is answered until the Node server is: a request that arrived first
    // would only be refused.
    Front.Log("[server] waiting for the Node server");
    if (!await Front.WaitForUpstream(upstreamUri!, node, TimeSpan.FromMinutes(5)))
    {
        Front.Log("[server] the Node server didn't start; stopping");
        return node?.HasExited == true ? node.ExitCode : 1;
    }
    Front.Log("[server] the Node server is up");
    // Its version, before anything is answered: of another, everything goes to it (Front.cs, v0.8.25).
    await Library.Ask();
}
// The background work (Jobs.cs) before anything is answered: taken over from
// the Node server, or this server's own from the start.
if (alone) await Jobs.StartAlone(ownConfig!, port, dataDir, version); else await Jobs.Start(upstreamUri!, frontKey, port, dataDir, version);
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
    // Which albums the library holds, on every answer to a signed-in device,
    // whoever made it (v0.8.43, Library.AlbumSet): the page reads its rows
    // again when it moves.
    if (ctx.Request.Path.StartsWithSegments("/api"))
        ctx.Response.OnStarting(() =>
        {
            if (ctx.Items.ContainsKey(Auth.SignedIn) && Library.AlbumSetNow is { Length: > 0 } set) ctx.Response.Headers["X-Mandarin-Library"] = set;
            return Task.CompletedTask;
        });
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
// A renderer's NOTIFY, once this server holds playback (UpnpEventRoutes.cs).
UpnpEventRoutes.Use(app);

var invoker = Front.Invoker();
var transformer = new ForwardTransformer();
var requestConfig = new Yarp.ReverseProxy.Forwarder.ForwarderRequestConfig
{
    // A stream to a renderer, a held request: as long as they last.
    ActivityTimeout = TimeSpan.FromHours(6),
};

// A Node server of another version behind this one (an update from Settings
// half done, Front.cs): everything is passed to it as it came, but for this
// server's own /server-info, until the two match (v0.8.25). Its private
// addresses stay closed from outside, as the gate keeps them.
var forwarder = app.Services.GetRequiredService<Yarp.ReverseProxy.Forwarder.IHttpForwarder>();
app.Use(async (ctx, next) =>
{
    if (Front.Matched || ctx.Request.Path == "/server-info") { await next(); return; }
    if (ctx.Request.Path.StartsWithSegments("/internal")) { ctx.Response.StatusCode = 404; return; }
    await forwarder.SendAsync(ctx, upstream!, invoker, requestConfig, transformer);
});

// The gate (Auth.cs): nothing but the sign-in page and its parts until the
// account exists and the device has signed in.
app.Use((ctx, next) => Auth.Gate(ctx, () => next(ctx)));

// The page and its files (Pages.cs), behind the gate as before.
Pages.Use(app, Path.Combine(appDir, "public"));
// The library (Library.cs): read here, from the copy the Node server holds.
Library.Use(app);
// Covers and label logos already drawn (Images.cs); the rest are drawn by the Node server.
Images.Use(app, dataDir);
// An album's booklets, their pages drawn in data/booklets (v0.8.33, Booklets.cs).
Booklets.Init(dataDir);
// Music files sent as they are (Streams.cs); conversions are the Node server's.
Streams.Use(app, dataDir);
// The phone's downloads and its Opus away from home (Downloads.cs).
Downloads.Use(app);
// Routes are chosen only after that: the static files step aside for any
// request a route has already matched, and the catch-all below matches all.
app.UseRouting();
// A deep link, the page for any address it opens, once no route here took it (v0.8.48, Pages.cs).
Pages.UseDeepLinks(app);

// What C# answers itself. Everything else goes to the Node server.
Routes.Map(app, version);
Auth.Map(app);

// Alone, what no route took is not there (as Express said it); else the Node server's.
if (alone) app.MapFallback(ctx => { ctx.Response.StatusCode = 404; return ctx.Response.WriteAsync($"Cannot {ctx.Request.Method} {ctx.Request.Path}"); });
else app.MapForwarder("/{**catch-all}", upstream!, requestConfig, transformer, invoker);

// Alone: Restart and Shut down from Settings are this program's own (PowerRoutes.cs).
if (alone)
{
    Front.RunsNode = true;
    Front.StopApp = app.Services.GetRequiredService<IHostApplicationLifetime>().StopApplication;
}
// The Node server stopping (Shut down, a crash) stops this too, with its
// code, so Docker's restart policy and the Mac's login item act as before.
if (node != null)
{
    var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
    node.EnableRaisingEvents = true;
    node.Exited += (_, _) =>
    {
        // Restart or Shut down from Settings (PowerRoutes.cs): it was stopped for
        // that, by the stop already under way. Not asked to stop again: that
        // stop holds the host's lock while it waits for this very process, and
        // asking again here could wait on it in turn (seen: Shut down left
        // hanging, the Node server gone).
        // The same when this server was already stopping (docker stop, Ctrl-C).
        if (Front.Leaving != Front.Leave.No || lifetime.ApplicationStopping.IsCancellationRequested) { Front.Log($"[server] the Node server stopped (code {node.ExitCode})"); return; }
        Front.Log($"[server] the Node server stopped (code {node.ExitCode}); stopping");
        Environment.ExitCode = node.ExitCode;
        lifetime.StopApplication();
    };
    lifetime.ApplicationStopping.Register(() => Front.StopNode(node));
    Front.RunsNode = true;
    Front.StopApp = lifetime.StopApplication;
}

app.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping.Register(Jobs.Stop);
await app.StartAsync();
Front.Log($"[server] listening on port {port}");
await app.WaitForShutdownAsync();
// The Node server asking for this program to start again (v0.8.25): a newer one
// was put in its place (lib/server/csharp-update.js). Started again in this
// process; if that can't be done, stopped with the code, and Docker's restart
// policy starts the container again.
// Restart from Settings (v0.8.31): both servers, this one started again in
// this process as after an update; Shut down: 0, for nothing to start it again.
if ((node != null || alone) && Front.Leaving == Front.Leave.Restart) { Front.StartAgain(args); return Front.StartAgainCode; }
if ((node != null || alone) && Front.Leaving == Front.Leave.ShutDown) return 0;
if (node != null && Environment.ExitCode == Front.StartAgainCode) Front.StartAgain(args);
return Environment.ExitCode;
