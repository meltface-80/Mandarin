using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// A backup sealed with a passphrase (v0.9.0, the audit's S1; Admin/Backup.Seal.cs):
///   - the API keys, the Qobuz and Tidal sign-ins and the server's Tailscale identity are in no part of
///     the file but the sealed one; a whole database's copy leaves them out too, with the account, the
///     signed-in devices and the signing secret, which a restore never takes from it;
///   - restoring them asks for the passphrase: without it, or with another, refused before anything
///     changes; with it, back as from a backup without one. The rest of a sealed backup restores without it;
///   - a passphrase under 8 characters is refused.
/// A backup without a passphrase restores as before: BackupTests (test/backup-sealed.test.js, in C#).
/// </summary>
public sealed class BackupSealedTests
{
    private const string Pass = "corréct horse 🐴 battery";

    // The header carries it as base64 of its UTF-8: a header is one byte a character.
    private static Dictionary<string, string> PassHeader(string p) => new() { ["X-Mandarin-Passphrase"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(p)) };

    private static async Task<JsonNode> ReadBackup(string file, string? db = null) =>
        (await Score.Run(new { fn = "backup", reads = new[] { new { file, db } } }))["read"]![0]!;

    private static string Tmp() => Directory.CreateTempSubdirectory("mandarin-sealed-").FullName;

    private static string Gunzip(byte[] file)
    {
        using var z = new GZipStream(new MemoryStream(file), CompressionMode.Decompress);
        using var o = new MemoryStream();
        z.CopyTo(o);
        return Encoding.Latin1.GetString(o.ToArray());
    }

    private static void Same(Http.Answer r, int status, string json)
    {
        Assert.True(r.Status == status, r.Status + " " + r.Text);
        JsonAssert.Same(json, r.Json);
    }

    // A restore's restart: the same program started again, a boot id of its own.
    private sealed class Boots(string b)
    {
        private string? last;
        private async Task<string?> Boot() { try { return (await Http.Get(b + "/server-info")).Json.Str("boot"); } catch (HttpRequestException) { return null; } }
        public async Task<Boots> Init() { last = await Boot(); return this; }
        public async Task Restarted()
        {
            for (int i = 0; i < 300; i++) { var x = await Boot(); if (x != null && x != last) { last = x; return; } await Task.Delay(100); }
            throw new InvalidOperationException("the server didn't start again after the restore");
        }
    }

    [Test]
    public async Task Sealed_the_keys_and_the_Tailscale_identity_in_no_part_but_the_sealed_one_back_only_with_the_passphrase()
    {
        await using var s = await Session.Started();
        var boots = await new Boots(s.Base).Init();
        var db = s.Server;
        db.SetSetting("smartPicksHour", 7);
        db.SetSetting("discogsToken", "secret-discogs-S1");
        db.SetSetting("qobuz", new { user_auth_token = "secret-qobuz-S1", user = new { id = 1 } });
        var tsDir = Path.Combine(s.Lib.Data, "tailscale");
        Directory.CreateDirectory(tsDir);
        await File.WriteAllTextAsync(Path.Combine(tsDir, "tailscaled.state"), "secret-node-key-S1");

        // Too short a passphrase: refused, no file.
        Same(await s.Api("backup/file", new { include = new[] { "keys" }, passphrase = "short" }), 400, """{"error":"A passphrase needs 8 characters or more"}""");

        using var req = new StringContent(Http.Json(new { include = new[] { "settings", "collection", "keys" }, passphrase = Pass }), Encoding.UTF8, "application/json");
        var r = await Bytes.Post(s.Base + "/api/backup/file", req, s.H);
        Assert.Equal(200, r.Status);
        Assert.True(JsonNode.Parse(r.Header("x-mandarin-backup")!).Bool("sealed"), "said up front, for the app's list");
        var file = r.Body;
        var raw = Gunzip(file);
        foreach (var secret in new[] { "secret-discogs-S1", "secret-qobuz-S1", "secret-node-key-S1", Convert.ToBase64String(Encoding.UTF8.GetBytes("secret-node-key-S1")) })
            Assert.True(!raw.Contains(secret, StringComparison.Ordinal), secret + " is not in the file in the clear");
        var at = Path.Combine(Tmp(), "sealed.tar.gz");
        await File.WriteAllBytesAsync(at, file);
        var parts = (await ReadBackup(at))["parts"]!;
        Assert.True(parts["manifest"].Bool("sealed"));
        Assert.True(parts["server"]?["keys"] == null, "server.json without its keys");
        Assert.True(parts["server"]?["settings"].Num("smartPicksHour") == 7, "and with the rest");
        Assert.True(parts["tailscale"] == null, "no tailscale.json");
        Assert.Equal(("AES-256-GCM", "PBKDF2-SHA256", 600000.0), (parts["sealed"].Str("cipher"), parts["sealed"].Str("kdf"), parts["sealed"].Num("rounds") ?? 0));

        // Everything changed afterwards.
        db.SetSetting("smartPicksHour", 2);
        db.SetSetting("discogsToken", "other");
        Directory.Delete(tsDir, true);
        Task<Http.Answer> Restore(string which, Dictionary<string, string>? headers = null)
        {
            var c = new ByteArrayContent(file);
            c.Headers.ContentType = new MediaTypeHeaderValue("application/gzip");
            var h = new Dictionary<string, string>(s.H);
            foreach (var (k, v) in headers ?? []) h[k] = v;
            return Http.Send(HttpMethod.Post, s.Base + "/api/backup/restore?parts=" + which, c, h);
        }
        async Task<int> Kept() => (await s.Api("backup")).J["backups"].Items().Count();

        // The keys without the passphrase, or with another: refused, nothing changed, no "Before restore" kept.
        Same(await Restore("keys"), 422, """{"error":"This backup is sealed with a passphrase: enter it to restore the keys or the whole database"}""");
        Same(await Restore("settings,keys", PassHeader("correct horse battery")), 422, """{"error":"That passphrase doesn't open this backup"}""");
        Same(await Restore("keys", new() { ["X-Mandarin-Passphrase"] = "not base64!" }), 400, """{"error":"The passphrase didn't arrive whole"}""");
        Assert.Equal(("other", 2, 0), ((string?)db.Setting("discogsToken"), db.Setting("smartPicksHour")!.GetValue<int>(), await Kept()));

        // The rest without it.
        var j = await Restore("settings");
        Assert.True(j.Status == 200, j.Text);
        JsonAssert.Same("""["settings"]""", j.J["restored"]);
        Assert.Equal((7, "other"), (db.Setting("smartPicksHour")!.GetValue<int>(), (string?)db.Setting("discogsToken")));
        await boots.Restarted();

        // The keys with it: as from a backup without one, the Tailscale identity too.
        j = await Restore("keys", PassHeader(Pass));
        Assert.True(j.Status == 200, j.Text);
        Assert.Equal(["keys", "tailscale"], j.J["restored"].Items().Select(x => (string?)x).Order(StringComparer.Ordinal));
        Assert.Equal("secret-discogs-S1", (string?)db.Setting("discogsToken"));
        JsonAssert.Same("""{"user_auth_token":"secret-qobuz-S1","user":{"id":1}}""", db.Setting("qobuz"));
        Assert.Equal("secret-node-key-S1", await File.ReadAllTextAsync(Path.Combine(tsDir, "tailscaled.state")));
        await boots.Restarted();
    }

    [Test]
    public async Task Sealed_on_the_server_listed_as_sealed_the_whole_databases_copy_without_its_keys_or_sign_ins_put_back_with_the_passphrase()
    {
        await using var s = await Session.Started();
        var boots = await new Boots(s.Base).Init();
        var db = s.Server;
        db.SetSetting("discogsToken", "secret-discogs-S1");
        db.Exec("INSERT INTO favourites(key, added_at) VALUES('then', 1)");
        var authSecret = (string?)db.Setting("authSecret");
        Assert.True(!string.IsNullOrEmpty(authSecret), "the server's signing secret");

        var saved = await s.Api("backup/save", new { include = new { database = true }, passphrase = Pass });
        Assert.True(saved.Status == 200, saved.Text);
        Assert.True(saved.J["backup"].Bool("sealed"));
        var id = saved.J["backup"].Str("id") ?? saved.J["backup"]!["id"]!.ToJsonString();
        var listed = (await s.Api("backup")).J["backups"].Items().First(b => (b.Str("id") ?? b!["id"]!.ToJsonString()) == id);
        Assert.True(listed.Bool("sealed"), "the list says so: the page asks for the passphrase");

        // The file as downloaded: no key, no signing secret, no sign-in in it, not even in the database's free pages.
        var file = (await Bytes.Get(s.Base + "/api/backup/download/" + id, s.H)).Body;
        var raw = Gunzip(file);
        foreach (var secret in new[] { "secret-discogs-S1", authSecret! }) Assert.True(!raw.Contains(secret, StringComparison.Ordinal), "not in the file in the clear: " + secret[..6] + "…");
        var dir = Tmp();
        var copy = Path.Combine(dir, "copy.db");
        await File.WriteAllBytesAsync(Path.Combine(dir, "b.tar.gz"), file);
        Assert.True((await ReadBackup(Path.Combine(dir, "b.tar.gz"), copy)).Bool("hasDb"));
        using (var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = copy, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString()))
        {
            c.Open();
            long Count(string sql) { using var q = c.CreateCommand(); q.CommandText = sql; return (long)q.ExecuteScalar()!; }
            Assert.Equal((0L, 0L, 0L, 1L), (Count("SELECT COUNT(*) FROM account"), Count("SELECT COUNT(*) FROM devices"),
                Count("SELECT COUNT(*) FROM settings WHERE key IN ('discogsToken', 'authSecret', 'tailscale')"), Count("SELECT COUNT(*) FROM favourites")));
        }

        db.SetSetting("discogsToken", "later");
        db.Exec("INSERT INTO favourites(key, added_at) VALUES('later', 2)");
        Task<Http.Answer> ById(object body) => s.Api("backup/restore/" + id, body);
        Same(await ById(new { include = new[] { "database" } }), 422, """{"error":"This backup is sealed with a passphrase: enter it to restore the keys or the whole database"}""");
        Same(await ById(new { include = new[] { "database" }, passphrase = "not the passphrase" }), 422, """{"error":"That passphrase doesn't open this backup"}""");
        var ok = await ById(new { include = new[] { "database" }, passphrase = Pass });
        Assert.True(ok.Status == 200, ok.Text);
        JsonAssert.Same("""["database"]""", ok.J["restored"]);
        // Swapped in at the restart: the database as it was, its keys back, today's sign-in still good.
        await boots.Restarted();
        db.CloseDb();
        Assert.Equal(["then"], db.Rows("SELECT key FROM favourites ORDER BY key").Select(x => (string?)x["key"]));
        Assert.Equal("secret-discogs-S1", (string?)db.Setting("discogsToken"));
        Assert.True((string?)db.Setting("authSecret") == authSecret, "today's signing secret kept");
        Assert.True((await s.Api("backup")).Status == 200, "the same sign-in still works");
    }
}
