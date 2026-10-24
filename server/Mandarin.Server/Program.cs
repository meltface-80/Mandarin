// Program.cs — mandarin-server, Mandarin's server in C# (v0.8.1 on).
//
// Mandarin's server, whole: it listens on Mandarin's port (PORT, 3500) and
// answers everything itself. From v0.8.1 it stood in front of the Node server
// and took its parts over one by one; since v0.9.0 (stage 7 of
// old/csharp-migration.md) there is no Node server. Set up from the
// environment (Config.cs). See server/README.md.
//
//   PORT                 the port Mandarin is reached on (3500)
//   MANDARIN_APP_DIR     where the page is (public/; found by itself)
using System.Net;
using System.Runtime.InteropServices;
using Mandarin.Server;

// On a Mac (v0.8.29) the C library is libSystem: what this program imports as
// "libc" (the scan's file system, starting itself again, the pack's checks).
if (OperatingSystem.IsMacOS())
    NativeLibrary.SetDllImportResolver(typeof(Server).Assembly, (name, _, _) =>
        name == "libc" ? NativeLibrary.Load("/usr/lib/libSystem.B.dylib") : IntPtr.Zero);

var version = BuildVersion.Of(typeof(Server).Assembly);   // a test build's "1.1.4-t7" whole (item 141)
Server.Version = version;

// `mandarin-server --version`: this program's version, and nothing else — how
// an update checks a newer one before putting it in place (Admin/Updater.cs).
if (args.Length == 1 && args[0] == "--version")
{
    Console.WriteLine(version);
    return 0;
}

// `mandarin-server --srp-vector test/srp-vector.json`: the server's half of
// SRP against the fixed example the page and the Android app are checked
// against too (test/Mandarin.Tests/SrpTests.cs).
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
// line of JSON each (Tags/TagReader.cs).
if (args.Length >= 1 && args[0] == "tags")
{
    var paths = args.Length > 1 ? args[1..] : Console.In.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);
    foreach (var path in paths) Console.WriteLine(Mandarin.Server.Tags.TagReader.Line(path));
    return 0;
}
// `mandarin-server scan`: one library scan (Scan/ScanCommand.cs): its job on
// standard input, what it says on standard output (the tests').
if (args.Length >= 1 && args[0] == "scan") return Mandarin.Server.Scan.ScanCommand.Run();
// `mandarin-server db <data folder>`: the database made, or brought up to date
// (Schema.cs, v0.8.48), as the server does it as it starts.
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
// `mandarin-server --health`: the image's health check (v0.8.50, HealthRoutes.cs):
// GET /api/health on this port, 0 when it answers 200.
if (args.Length == 1 && args[0] == "--health") return await Library.HealthCommand(port);
// The key this server's private addresses (/internal/…, the tests') are asked with: given, or made.
string frontKey = Environment.GetEnvironmentVariable("MANDARIN_FRONT_KEY") is { Length: > 0 } fk ? fk
    : Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
// The data folder: the database (<data>/musicd.db), settings, caches.
string dataDir = Environment.GetEnvironmentVariable("DATA_DIR") is { Length: > 0 } dd ? dd
    : Path.Combine(Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir(), "data");
// `mandarin-server config`: what this server would be set up with, from the
// environment (Config.cs, v0.8.50), as the hand-over carried it — for the tests.
if (args.Length == 1 && args[0] == "config")
{
    try { Console.WriteLine(Config.FromEnvironment(dataDir, port).ToJsonString()); return 0; }
    catch (InvalidOperationException e) { Console.Error.WriteLine(e.Message); return 2; }
}
// `mandarin-server reset-password`: the account removed and every device signed out (Auth.Reset.cs, v0.8.50).
if (args.Length == 1 && args[0] == "reset-password") return Auth.ResetPasswordCommand(dataDir);
Db.File = Path.Combine(dataDir, "musicd.db");
Server.DataDir = dataDir;
string appDir = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir();
// A database put back from a backup goes in now, before it opens (Admin/Restore.cs);
// then the database made, or brought up to date (Schema.cs); a new one is a
// new install, whose optional parts start as a new install's do (Features.cs).
Mandarin.Server.Admin.Backup.SwapStaged(dataDir, Server.Log);
try { if (!Schema.Bring(dataDir, Server.Log).Existed) Features.NewInstall(); }
catch (Exception e) when (e is Microsoft.Data.Sqlite.SqliteException or IOException or UnauthorizedAccessException)
{
    Server.Log($"[server] the database couldn't be brought up to date ({e.Message}); stopping");
    return 1;
}
System.Text.Json.Nodes.JsonObject ownConfig;
try { ownConfig = Config.FromEnvironment(dataDir, port); }
catch (InvalidOperationException e) { Server.Log("[server] " + e.Message + "; stopping"); return 2; }
// The install's secret, for signed addresses (Auth.Secret.cs).
try { Auth.EnsureSecret(); }
catch (Microsoft.Data.Sqlite.SqliteException e) { Server.Log($"[server] the install's secret couldn't be written ({e.Message}); stopping"); return 1; }
Library.InitAlone(frontKey, ownConfig["server_ip"]?.GetValue<string>(), port);
Transcoder.Init(dataDir);
Downloads.Init(dataDir);
Server.Log($"[server] Mandarin's server {version} (C#) on port {port}");
// The background work (Jobs.cs) before anything is answered.
await Jobs.StartAlone(ownConfig, dataDir, port, version);
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
    // AdminRoutes.cs): one byte a character, as the Node server wrote a header,
    // where Kestrel would otherwise refuse anything past ASCII.
    k.ResponseHeaderEncodingSelector = name => name.Equals("X-Mandarin-Backup", StringComparison.OrdinalIgnoreCase) ? System.Text.Encoding.Latin1 : null;
    k.Listen(IPAddress.Any, port);
});
// gzip, as the Node server's compression() did for everything it answered:
// only text (never audio, never a stream of events).
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
});
// Stopping: within two seconds, not the usual thirty.
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

// MusicBrainz's one timer, a turn asked for (Identify/Lookups.cs).
Mandarin.Server.Identify.Lookups.UseInternal(app);
// The tests' words: a scan ended, the taste work, the prune, the services' watch (Jobs.cs).
Jobs.UseInternal(app);
// A word of a change made to the database by hand (the tests): the copy read again (Library.State.cs).
Library.UseInternal(app);
// A renderer's NOTIFY, once this server holds playback (UpnpEventRoutes.cs).
UpnpEventRoutes.Use(app);

// A JSON body past express.json's 2 MB is refused (Auth.Body.cs).
Auth.UseBodyLimit(app);
// The gate (Auth.cs): nothing but the sign-in page and its parts until the
// account exists and the device has signed in.
app.Use((ctx, next) => Auth.Gate(ctx, () => next(ctx)));

// The page and its files (Pages.cs), behind the gate as before.
Pages.Use(app, Path.Combine(appDir, "public"));
// The library (Library.cs): read from the copy held here (Library.State.cs).
Library.Use(app);
// Covers and label logos (Images.cs).
Images.Use(app, dataDir);
// An album's booklets, their pages drawn in data/booklets (v0.8.33, Booklets.cs).
Booklets.Init(dataDir);
// Music files, as they are or converted (Streams.cs, Transcoder.cs).
Streams.Use(app);
// The phone's downloads and its Opus away from home (Downloads.cs).
Downloads.Use(app);
// Routes are chosen only after that: the static files step aside for any
// request a route has already matched, and the catch-all below matches all.
app.UseRouting();
// A deep link, the page for any address it opens, once no route here took it (v0.8.48, Pages.cs).
Pages.UseDeepLinks(app);

// Which server answered (Server.cs), and the account's routes (Auth.cs).
Routes.Map(app, version);
Auth.Map(app);

// What no route took is not there, as Express said it (Pages.NotThere.cs).
// Under a catch-all pattern, so a deep link still takes the page first (Pages.cs Unclaimed).
app.MapFallback("/{**catch-all}", Pages.NotThere);

// Restart and Shut down from Settings (PowerRoutes.cs).
Server.StopApp = app.Services.GetRequiredService<IHostApplicationLifetime>().StopApplication;

app.Services.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping.Register(Jobs.Stop);
await app.StartAsync();
Server.Log($"[server] listening on port {port}");
await app.WaitForShutdownAsync();
// Restart from Settings, or an update put in place (Admin/Updater.cs): this
// program started again in this process; if that can't be done, stopped with
// the code, and Docker's restart policy starts the container again. Shut
// down: 0, for nothing to start it again.
if (Server.Leaving == Server.Leave.Restart) { Server.StartAgain(args); return Server.StartAgainCode; }
if (Server.Leaving == Server.Leave.ShutDown) return 0;
return Environment.ExitCode;
