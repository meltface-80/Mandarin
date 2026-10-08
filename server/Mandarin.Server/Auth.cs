// Auth.cs — one account, signed-in devices, and the gate in front of it all
// (moved from lib/server/auth.js in v0.8.2; the same rules, word for word).
//
// No cloud: the account lives in the server's database, made on first run from
// a device on the home network; until it exists the server serves nothing but
// the page that makes it. Signing in is SRP (Srp.cs, public/srp.js): the
// password never crosses the network. Each signed-in browser, app or wall
// display is a device with its own random token, only its hash stored;
// browsers carry it in an HttpOnly cookie, the Android app as a bearer token.
//
// The Node server behind keeps its own gate too (it reads the same tables), and
// still decides alone for streams and covers: a Sonos speaker can't sign in,
// and the addresses it is given carry a signature, or come from a speaker the
// Node server knows.
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Db
{
    public static string File = "";

    // A connection of its own each time, so a database put back from a backup
    // (swapped in while the Node server restarts) is the one read next.
    public static SqliteConnection Open()
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = File, Mode = SqliteOpenMode.ReadWrite, Pooling = false, DefaultTimeout = 10
        }.ToString());
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA busy_timeout = 5000";
        cmd.ExecuteNonQuery();
        return c;
    }

    // A setting as the Node server keeps it: JSON in settings.value.
    public static JsonNode? Setting(SqliteConnection c, string key)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        var v = cmd.ExecuteScalar() as string;
        if (v == null) return null;
        try { return JsonNode.Parse(v); } catch { return null; }
    }
}

internal sealed record Account(string Username, string Salt, string Verifier, int Iterations);
internal sealed record Device(string Id, string Name, string Kind, long LastSeen);

internal static class Auth
{
    public const string Cookie = "musicd_session";
    private const long Year = 365 * 86400;
    private const long ReauthMs = 5 * 60 * 1000;
    private const int MinIterations = 1000;

    private static readonly HashSet<string> Open = ["/api/health", "/login", "/login.html", "/login.js", "/srp.js", "/manifest.json",
        "/favicon.ico", "/apple-touch-icon.png", "/server-info"];
    private static bool IsOpen(string p) => Open.Contains(p) || p.StartsWith("/api/auth/", StringComparison.Ordinal) || p.StartsWith("/icons/", StringComparison.Ordinal);
    private static bool IsMedia(string p) => p.StartsWith("/stream/", StringComparison.Ordinal) || p.StartsWith("/api/image/", StringComparison.Ordinal);

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ------------------------------------------------------------ the database

    private static Account? GetAccount(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT username, salt, verifier, iterations FROM account WHERE id = 1";
        using var r = cmd.ExecuteReader();
        return r.Read() ? new Account(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt32(3)) : null;
    }

    private static string Secret(SqliteConnection c) => Db.Setting(c, "authSecret")?.GetValue<string>() ?? "";

    private static string Sha256Hex(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    private static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // ------------------------------------------------------------ who is asking

    public static string ClientIp(HttpContext ctx) => ForwardTransformer.ClientIp(ctx);

    // Private and link-local ranges: "the home network". Tailscale's addresses
    // (100.64.0.0/10, and fd7a:115c:a1e0::/48) are not: over Tailscale is away.
    public static bool IsLocal(string ip)
    {
        var a = ip ?? "";
        if (a.StartsWith("::ffff:", StringComparison.Ordinal)) a = a[7..];
        if (a == "::1" || a.StartsWith("127.", StringComparison.Ordinal)) return true;
        if (a.StartsWith("fd7a:115c:a1e0:", StringComparison.OrdinalIgnoreCase)) return false;
        if (a.StartsWith("fe80:", StringComparison.OrdinalIgnoreCase)) return true;
        if (a.Length >= 5 && (a[0] == 'f' || a[0] == 'F') && (a[1] == 'c' || a[1] == 'd' || a[1] == 'C' || a[1] == 'D')
            && Uri.IsHexDigit(a[2]) && Uri.IsHexDigit(a[3]) && a[4] == ':') return true;
        var parts = a.Split('.');
        if (parts.Length != 4 || !parts.All(p => p.Length > 0 && p.All(char.IsAsciiDigit))) return false;
        int x = int.Parse(parts[0]), y = int.Parse(parts[1]);
        return x == 10 || (x == 172 && y >= 16 && y <= 31) || (x == 192 && y == 168) || (x == 169 && y == 254);
    }

    public static bool IsAway(HttpContext ctx) => !IsLocal(ClientIp(ctx));

    private static string? TokenOf(HttpContext ctx)
    {
        var h = ctx.Request.Headers.Authorization.ToString();
        if (h.StartsWith("Bearer", StringComparison.OrdinalIgnoreCase) && h.Length > 6 && char.IsWhiteSpace(h[6])) return h[6..].Trim();
        return ParseCookies(ctx.Request.Headers.Cookie.ToString()).GetValueOrDefault(Cookie);
    }

    private static Dictionary<string, string> ParseCookies(string header)
    {
        var o = new Dictionary<string, string>();
        foreach (var part in header.Split(';'))
        {
            int i = part.IndexOf('=');
            if (i < 0) continue;
            var k = part[..i].Trim();
            if (k.Length > 0) { try { o[k] = Uri.UnescapeDataString(part[(i + 1)..].Trim()); } catch { o[k] = part[(i + 1)..].Trim(); } }
        }
        return o;
    }

    // The signed-in device making this request, or null (once per request).
    public static Device? DeviceOf(HttpContext ctx, SqliteConnection c)
    {
        if (ctx.Items.TryGetValue("device", out var cached)) return cached as Device;
        Device? dev = null;
        var t = TokenOf(ctx);
        if (!string.IsNullOrEmpty(t) && GetAccount(c) != null)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT id, name, kind, last_seen FROM devices WHERE token_hash = $h";
            cmd.Parameters.AddWithValue("$h", Sha256Hex(t));
            using (var r = cmd.ExecuteReader())
                if (r.Read()) dev = new Device(r.GetString(0), r.GetString(1), r.GetString(2), r.GetInt64(3));
            if (dev != null && Now - dev.LastSeen > 60000)
            {
                using var up = c.CreateCommand();
                up.CommandText = "UPDATE devices SET last_seen = $t, last_ip = $ip WHERE id = $id";
                up.Parameters.AddWithValue("$t", Now); up.Parameters.AddWithValue("$ip", ClientIp(ctx)); up.Parameters.AddWithValue("$id", dev.Id);
                up.ExecuteNonQuery();
            }
        }
        ctx.Items["device"] = dev;
        return dev;
    }

    // "iPhone · Safari" from a browser's user agent — enough to tell devices apart.
    public static string DeviceNameFromUA(string ua)
    {
        string s = ua ?? "";
        bool has(string x) => s.Contains(x, StringComparison.Ordinal);
        string os = has("iPhone") ? "iPhone" : has("iPad") ? "iPad" : has("Android") ? "Android"
            : has("Macintosh") ? "Mac" : has("Windows") ? "Windows" : has("CrOS") ? "Chromebook"
            : has("Linux") ? "Linux" : "Browser";
        string br = has("Edg/") ? "Edge" : has("Firefox/") ? "Firefox" : (has("CriOS") || has("Chrome/")) ? "Chrome"
            : has("Safari/") ? "Safari" : "";
        return br.Length > 0 ? $"{os} · {br}" : os;
    }

    private static string CleanName(string? s, string fallback)
    {
        var t = new string((s ?? "").Where(ch => ch > '\u001f').ToArray()).Trim();
        if (t.Length > 80) t = t[..80];
        return t.Length > 0 ? t : fallback;
    }

    private static bool IsHex(JsonNode? n, int min, int max)
    {
        if (n is not JsonValue v || !v.TryGetValue<string>(out var s)) return false;
        return s.Length >= min && s.Length <= max && s.Length % 2 == 0 && s.All(Uri.IsHexDigit);
    }

    // ------------------------------------------------------------ devices

    private static (string token, JsonObject device) IssueDevice(HttpContext ctx, SqliteConnection c, JsonObject b)
    {
        var token = B64Url(RandomNumberGenerator.GetBytes(32));
        var id = B64Url(RandomNumberGenerator.GetBytes(9));
        var name = CleanName(Js.Str(b["device_name"]), DeviceNameFromUA(ctx.Request.Headers.UserAgent.ToString()));
        var kind = Js.Str(b["kind"]) == "android" ? "android" : "browser";
        var ip = ClientIp(ctx);
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO devices(id, token_hash, name, kind, created_at, last_seen, last_ip) VALUES($id, $h, $n, $k, $t, $t, $ip)";
        cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$h", Sha256Hex(token));
        cmd.Parameters.AddWithValue("$n", name); cmd.Parameters.AddWithValue("$k", kind);
        cmd.Parameters.AddWithValue("$t", Now); cmd.Parameters.AddWithValue("$ip", ip);
        cmd.ExecuteNonQuery();
        Front.Log($"[auth] signed in: {name} ({kind}) from {ip}");
        return (token, new JsonObject { ["id"] = id, ["name"] = name, ["kind"] = kind });
    }

    private static void SetCookie(HttpContext ctx, string token, bool remember)
    {
        bool secure = ctx.Request.IsHttps || ctx.Request.Headers["X-Forwarded-Proto"].ToString() == "https";
        ctx.Response.Headers.Append("Set-Cookie", $"{Cookie}={Js.EncodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax" +
            (remember ? $"; Max-Age={Year}" : "") + (secure ? "; Secure" : ""));
    }

    private static void ClearCookie(HttpContext ctx) =>
        ctx.Response.Headers.Append("Set-Cookie", $"{Cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");

    // ------------------------------------------------------------ lockout
    // Five wrong passwords from one address in 15 minutes locks that address
    // out for 15 minutes; every failure anywhere also slows the next attempt.
    private static readonly object lockGate = new();
    private static readonly Dictionary<string, List<long>> failures = new();
    private static List<long> recentFailures = [];

    private static long LockedFor(string ip)
    {
        lock (lockGate)
        {
            var now = Now;
            var list = (failures.GetValueOrDefault(ip) ?? []).Where(t => now - t < 15 * 60000).ToList();
            failures[ip] = list;
            return list.Count >= 5 ? Math.Max(0, list[^1] + 15 * 60000 - now) : 0;
        }
    }

    private static void Failed(string ip)
    {
        lock (lockGate)
        {
            var now = Now;
            failures[ip] = (failures.GetValueOrDefault(ip) ?? []).Append(now).ToList();
            recentFailures = recentFailures.Where(t => now - t < 3600000).Append(now).ToList();
            if (failures.Count > 5000) failures.Remove(failures.Keys.First());
        }
        Front.Log($"[auth] wrong password from {ip}");
    }

    private static Task Slowdown()
    {
        int n; lock (lockGate) n = recentFailures.Count;
        return Task.Delay(Math.Min(3000, 150 * n));
    }

    // ------------------------------------------------------------ SRP sessions
    private sealed record Challenge(string Username, Srp.Start Start, bool Real, long Expires);
    private static readonly ConcurrentDictionary<string, Challenge> challenges = new();
    private static readonly ConcurrentDictionary<string, long> reauthed = new();   // device id → until

    private static void Sweep()
    {
        var now = Now;
        foreach (var kv in challenges) if (kv.Value.Expires < now) challenges.TryRemove(kv.Key, out _);
        while (challenges.Count > 500) { var k = challenges.Keys.FirstOrDefault(); if (k == null) break; challenges.TryRemove(k, out _); }
    }

    // A made-up account for a username that doesn't exist, so a stranger can't
    // tell which names are real. The same name always gets the same salt.
    private static Account Decoy(string username, string secret)
    {
        using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var salt = Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes("salt:" + username))).ToLowerInvariant()[..32];
        var x = Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes("x:" + username))).ToLowerInvariant();
        return new Account(username, salt, x, Srp.Iterations);
    }

    // ------------------------------------------------------------ the gate

    public static async Task Gate(HttpContext ctx, Func<Task> next)
    {
        var p = ctx.Request.Path.Value ?? "/";
        // The Node server's loopback-only routes (a Tidal stream's pieces for
        // ffmpeg): it fetches them from its own port, never through here.
        if (p.StartsWith("/internal/", StringComparison.Ordinal)) { ctx.Response.StatusCode = 404; ctx.Response.Headers["X-Mandarin-Answered"] = "C#"; return; }
        // Streams and covers: the Node server's to decide (signatures, the
        // speakers). A renderer's NOTIFY (UPnP eventing): a device can't sign
        // in, and the Node server takes it before its own gate, as before.
        if (IsOpen(p) || IsMedia(p) || p.StartsWith("/upnp/event", StringComparison.Ordinal)) { await next(); return; }
        Account? acct; Device? dev;
        using (var c = Db.Open()) { acct = GetAccount(c); dev = acct != null ? DeviceOf(ctx, c) : null; }
        if (acct != null && dev != null) { await next(); return; }
        bool page = ctx.Request.Method == "GET" && !p.StartsWith("/api/", StringComparison.Ordinal) && !IsMedia(p)
            && !System.Text.RegularExpressions.Regex.IsMatch(p, @"\.(js|css|png|jpe?g|svg|ico|woff2?|json|map)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (page)
        {
            ctx.Response.StatusCode = 302;
            ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
            ctx.Response.Headers.Location = "/login?next=" + Js.EncodeURIComponent(OriginalUrl(ctx));
            return;
        }
        await Json(ctx, 401, acct != null
            ? new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }
            : new JsonObject { ["error"] = "Create the Mandarin account first", ["setup_required"] = true });
    }

    // The address as asked for: the path and query as they came, a proxy's
    // whole-address form ("GET http://host:3500/…", the Android app's relay)
    // made the usual path.
    private static string OriginalUrl(HttpContext ctx)
    {
        var raw = ctx.Features.Get<IHttpRequestFeature>()?.RawTarget ?? (ctx.Request.Path + ctx.Request.QueryString).ToString();
        if (raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            if (Uri.TryCreate(raw, UriKind.Absolute, out var u)) raw = u.PathAndQuery;
        }
        return raw;
    }

    // ------------------------------------------------------------ the routes

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/auth/status", (HttpContext ctx) =>
        {
            using var c = Db.Open();
            var acct = GetAccount(c);
            var dev = DeviceOf(ctx, c);
            return Json(ctx, 200, new JsonObject
            {
                ["setup_required"] = acct == null,
                ["can_setup"] = acct == null && IsLocal(ClientIp(ctx)),
                ["away"] = IsAway(ctx),
                ["signed_in"] = dev != null,
                ["username"] = dev != null ? acct!.Username : null,
                ["device"] = dev != null ? new JsonObject { ["id"] = dev.Id, ["name"] = dev.Name, ["kind"] = dev.Kind } : null
            });
        });

        app.MapPost("/api/auth/setup", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            using var c = Db.Open();
            if (GetAccount(c) != null) { await Error(ctx, 409, "The account already exists — sign in instead"); return; }
            if (!IsLocal(ClientIp(ctx))) { await Error(ctx, 403, "Create the account from a device on your home network"); return; }
            var username = Srp.NormUser(Js.Str(b["username"]));
            var iterations = Js.ParseInt(b["iterations"]);
            if (username.Length == 0 || username.Length > 64 || username.Any(ch => ch <= '\u001f')) { await Error(ctx, 400, "Choose a username"); return; }
            var verifier = Js.Str(b["verifier"]);
            if (!IsHex(b["salt"], 32, 128) || !IsHex(b["verifier"], 2, 512) || verifier.All(ch => ch == '0')) { await Error(ctx, 400, "Bad account details"); return; }
            if (!(iterations >= MinIterations && iterations <= 10000000)) { await Error(ctx, 400, "Bad account details"); return; }
            using var cmd = c.CreateCommand();
            // Setup never replaces an account, even when two devices race to make one.
            cmd.CommandText = @"INSERT OR IGNORE INTO account(id, username, salt, verifier, iterations, created_at, updated_at)
                                VALUES(1, $u, $s, $v, $i, $t, $t)";
            cmd.Parameters.AddWithValue("$u", username); cmd.Parameters.AddWithValue("$s", Js.Str(b["salt"]).ToLowerInvariant());
            cmd.Parameters.AddWithValue("$v", verifier.ToLowerInvariant()); cmd.Parameters.AddWithValue("$i", iterations);
            cmd.Parameters.AddWithValue("$t", Now);
            if (cmd.ExecuteNonQuery() == 0) { await Error(ctx, 409, "The account already exists — sign in instead"); return; }
            Front.Log($"[auth] account created for {username} from {ClientIp(ctx)}");
            var (token, device) = IssueDevice(ctx, c, b);
            if (Js.Truthy(b["want_token"])) { await Json(ctx, 200, new JsonObject { ["ok"] = true, ["token"] = token, ["device"] = device, ["username"] = username }); return; }
            SetCookie(ctx, token, !Js.IsFalse(b["remember"]));
            await Json(ctx, 200, new JsonObject { ["ok"] = true, ["device"] = device, ["username"] = username });
        });

        app.MapPost("/api/auth/challenge", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            var ip = ClientIp(ctx);
            var wait = LockedFor(ip);
            if (wait > 0) { await Error(ctx, 429, $"Too many wrong passwords — try again in {(int)Math.Ceiling(wait / 60000.0)} min"); return; }
            using var c = Db.Open();
            var acct = GetAccount(c);
            if (acct == null) { await Json(ctx, 409, new JsonObject { ["error"] = "Create the account first", ["setup_required"] = true }); return; }
            var username = Srp.NormUser(Js.Str(b["username"]));
            bool real = username == acct.Username;
            var rec = real ? acct : Decoy(username, Secret(c));
            var start = Srp.ServerStart(rec.Verifier);
            Sweep();
            var id = B64Url(RandomNumberGenerator.GetBytes(12));
            challenges[id] = new Challenge(username, start, real, Now + 60000);
            await Json(ctx, 200, new JsonObject { ["id"] = id, ["salt"] = rec.Salt, ["iterations"] = rec.Iterations, ["B"] = start.B });
        });

        app.MapPost("/api/auth/verify", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            var ip = ClientIp(ctx);
            var wait = LockedFor(ip);
            if (wait > 0) { await Error(ctx, 429, $"Too many wrong passwords — try again in {(int)Math.Ceiling(wait / 60000.0)} min"); return; }
            var cid = Js.Str(b["id"]);
            challenges.TryRemove(cid, out var ch);
            if (ch == null || ch.Expires < Now) { await Error(ctx, 400, "That sign-in took too long — try again"); return; }
            await Slowdown();
            var r = ch.Real && IsHex(b["A"], 2, 512) ? Srp.ServerVerify(ch.Start, Js.Str(b["A"]), Js.Str(b["M1"])) : new Srp.Result(false, null);
            if (!r.Ok) { Failed(ip); await Error(ctx, 401, "Wrong username or password"); return; }
            lock (lockGate) failures.Remove(ip);
            using var c = Db.Open();
            if (Js.Str(b["purpose"]) == "reauth")
            {
                var dev = DeviceOf(ctx, c);
                if (dev == null) { await Error(ctx, 401, "Sign in first"); return; }
                reauthed[dev.Id] = Now + ReauthMs;
                await Json(ctx, 200, new JsonObject { ["ok"] = true, ["M2"] = r.M2 });
                return;
            }
            var (token, device) = IssueDevice(ctx, c, b);
            if (Js.Truthy(b["want_token"])) { await Json(ctx, 200, new JsonObject { ["ok"] = true, ["M2"] = r.M2, ["token"] = token, ["device"] = device, ["username"] = ch.Username }); return; }
            SetCookie(ctx, token, !Js.IsFalse(b["remember"]));
            await Json(ctx, 200, new JsonObject { ["ok"] = true, ["M2"] = r.M2, ["device"] = device, ["username"] = ch.Username });
        });

        app.MapPost("/api/auth/logout", async (HttpContext ctx) =>
        {
            using var c = Db.Open();
            var dev = DeviceOf(ctx, c);
            if (dev != null) { Drop(c, dev.Id); Front.Log($"[auth] signed out: {dev.Name}"); }
            ClearCookie(ctx);
            await Json(ctx, 200, new JsonObject { ["ok"] = true });
        });

        app.MapGet("/api/auth/devices", async (HttpContext ctx) =>
        {
            using var c = Db.Open();
            var dev = DeviceOf(ctx, c);
            if (dev == null) { await Json(ctx, 401, new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }); return; }
            var list = new JsonArray();
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT id, name, kind, created_at, last_seen, last_ip FROM devices ORDER BY last_seen DESC";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                    list.Add(new JsonObject
                    {
                        ["id"] = r.GetString(0), ["name"] = r.GetString(1), ["kind"] = r.GetString(2),
                        ["created_at"] = r.GetInt64(3), ["last_seen"] = r.GetInt64(4), ["last_ip"] = r.IsDBNull(5) ? null : r.GetString(5),
                        ["current"] = r.GetString(0) == dev.Id
                    });
            }
            await Json(ctx, 200, new JsonObject { ["username"] = GetAccount(c)?.Username, ["devices"] = list });
        });

        app.MapPost("/api/auth/devices/revoke", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            using var c = Db.Open();
            var dev = DeviceOf(ctx, c);
            if (dev == null) { await Json(ctx, 401, new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }); return; }
            var id = Js.Str(b["id"]);
            int n = Drop(c, id);
            if (n > 0) Front.Log($"[auth] device {id} signed out by {dev.Name}");
            if (id == dev.Id) ClearCookie(ctx);
            await Json(ctx, 200, new JsonObject { ["ok"] = n > 0 });
        });

        app.MapPost("/api/auth/password", async (HttpContext ctx) =>
        {
            var b = await Body(ctx);
            if (b == null) return;
            using var c = Db.Open();
            var dev = DeviceOf(ctx, c);
            if (dev == null) { await Json(ctx, 401, new JsonObject { ["error"] = "Sign in to Mandarin", ["sign_in_required"] = true }); return; }
            if (!(reauthed.GetValueOrDefault(dev.Id) > Now)) { await Error(ctx, 403, "Enter your current password first"); return; }
            var iterations = Js.ParseInt(b["iterations"]);
            if (!IsHex(b["salt"], 32, 128) || !IsHex(b["verifier"], 2, 512) || !(iterations >= MinIterations && iterations <= 10000000))
            { await Error(ctx, 400, "Bad account details"); return; }
            var acct = GetAccount(c)!;
            using var cmd = c.CreateCommand();
            cmd.CommandText = @"INSERT INTO account(id, username, salt, verifier, iterations, created_at, updated_at)
                                VALUES(1, $u, $s, $v, $i, $t, $t)
                                ON CONFLICT(id) DO UPDATE SET username=excluded.username, salt=excluded.salt,
                                  verifier=excluded.verifier, iterations=excluded.iterations, updated_at=excluded.updated_at";
            cmd.Parameters.AddWithValue("$u", acct.Username); cmd.Parameters.AddWithValue("$s", Js.Str(b["salt"]).ToLowerInvariant());
            cmd.Parameters.AddWithValue("$v", Js.Str(b["verifier"]).ToLowerInvariant()); cmd.Parameters.AddWithValue("$i", iterations);
            cmd.Parameters.AddWithValue("$t", Now);
            cmd.ExecuteNonQuery();
            reauthed.TryRemove(dev.Id, out _);
            Front.Log($"[auth] password changed from {dev.Name}");
            await Json(ctx, 200, new JsonObject { ["ok"] = true });
        });
    }

    private static int Drop(SqliteConnection c, string id)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM devices WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        return cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------ JSON in and out

    // The request's JSON body, as the Node server's parser reads it: {} when
    // there is none or it isn't JSON; a 400 (and null) when it says JSON but isn't.
    public static async Task<JsonObject?> Body(HttpContext ctx)
    {
        var type = ctx.Request.ContentType ?? "";
        if (!type.Contains("json", StringComparison.OrdinalIgnoreCase)) return [];
        try
        {
            var n = await JsonNode.ParseAsync(ctx.Request.Body);
            return n as JsonObject ?? [];
        }
        catch (JsonException)
        {
            await Error(ctx, 400, "Bad JSON");
            return null;
        }
    }

    public static Task Json(HttpContext ctx, int status, JsonObject o)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        // Answered here, not passed on (the tests check which).
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        return ctx.Response.WriteAsync(o.ToJsonString());
    }

    private static Task Error(HttpContext ctx, int status, string message) => Json(ctx, status, new JsonObject { ["error"] = message });
}

// What JavaScript would make of a JSON value, where the rules above come from it.
internal static class Js
{
    // String(x || "")
    public static string Str(JsonNode? n) => n switch
    {
        null => "",
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? "true" : "",
        JsonValue v when v.TryGetValue<double>(out var d) => d == 0 ? "" : d.ToString(System.Globalization.CultureInfo.InvariantCulture),
        _ => n.ToJsonString()
    };

    public static bool Truthy(JsonNode? n) => n switch
    {
        null => false,
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0,
        JsonValue v when v.TryGetValue<double>(out var d) => d != 0 && !double.IsNaN(d),
        _ => true
    };

    public static bool IsFalse(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && !b;

    // parseInt(x, 10): the leading digits, or int.MinValue for NaN.
    public static long ParseInt(JsonNode? n)
    {
        string s = n is JsonValue v && v.TryGetValue<double>(out var d) ? Math.Truncate(d).ToString(System.Globalization.CultureInfo.InvariantCulture) : Str(n);
        s = s.TrimStart();
        int i = 0;
        bool neg = false;
        if (i < s.Length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++; }
        int start = i;
        while (i < s.Length && char.IsAsciiDigit(s[i])) i++;
        if (i == start) return int.MinValue;
        return long.TryParse(s[start..i], out var r) ? (neg ? -r : r) : long.MaxValue;
    }

    // encodeURIComponent: everything escaped but A–Z a–z 0–9 - _ . ! ~ * ' ( ).
    public static string EncodeURIComponent(string s)
    {
        var sb = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(s))
        {
            char ch = (char)b;
            if (b < 0x80 && (char.IsAsciiLetterOrDigit(ch) || "-_.!~*'()".Contains(ch))) sb.Append(ch);
            else sb.Append('%').Append(b.ToString("X2"));
        }
        return sb.ToString();
    }
}
