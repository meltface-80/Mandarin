// Backup.Seal.cs — a backup sealed with a passphrase (v0.9.0, the audit's S1,
// old/audit-b4-main.md).
//
// What in a backup opens doors elsewhere travels sealed when a passphrase is
// given: the API keys with the Qobuz and Tidal sign-ins (the keys part, or
// the same settings taken out of a whole database's copy) and the server's
// Tailscale identity. They go in one part, sealed.json: AES-256-GCM, its key
// drawn from the passphrase with PBKDF2 (SHA-256, 600 000 rounds, a salt of
// its own). A whole database's copy also leaves out what a restore never
// takes from it: the account, the signed-in devices, the server's signing
// secret and its Tailscale setting (KeepTables, KeepSettings). The rest of the
// file is as before, so a backup without a passphrase restores as it always
// has, and a sealed one gives back everything else without it.
using System.Security.Cryptography;
using System.Text;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Backup
{
    public const int SealRounds = 600_000;
    private const string Cipher = "AES-256-GCM", Kdf = "PBKDF2-SHA256";
    // Bound into the seal: a sealed part of something else doesn't open here.
    private static readonly byte[] SealLabel = Encoding.UTF8.GetBytes("mandarin-backup-sealed-1");

    /* A passphrase that seals: eight characters at least. */
    public static string? Passphrase(object? v)
    {
        if (v is not string s || s.Length == 0) return null;
        if (s.Length < 8) throw new Refused("A passphrase needs 8 characters or more");
        return s;
    }

    /* Whether a backup of these parts with this passphrase is sealed: the keys, or the whole database (which holds them). */
    public static bool Seals(IReadOnlyDictionary<string, bool> include, string? passphrase) =>
        passphrase != null && ((include.TryGetValue("keys", out var k) && k) || (include.TryGetValue("database", out var d) && d));

    /* The keys part, as the snapshot takes it, for the seal of a whole database. */
    public static JsObj KeysOf(SqliteConnection c) => SettingsOf(c, KeyKeys);

    private static byte[] SealKey(string passphrase, byte[] salt, int rounds) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(passphrase), salt, rounds, HashAlgorithmName.SHA256, 32);

    /* sealed.json: `inner` sealed with the passphrase. */
    public static JsObj Seal(JsObj inner, string passphrase)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(Js.Json(inner) ?? "{}");
        var data = new byte[plain.Length + 16];
        var key = SealKey(passphrase, salt, SealRounds);
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(nonce, plain, data.AsSpan(0, plain.Length), data.AsSpan(plain.Length), SealLabel);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
            CryptographicOperations.ZeroMemory(key);
        }
        return new JsObj
        {
            ["cipher"] = Cipher, ["kdf"] = Kdf, ["rounds"] = (double)SealRounds,
            ["salt"] = Convert.ToBase64String(salt), ["nonce"] = Convert.ToBase64String(nonce), ["data"] = Convert.ToBase64String(data)
        };
    }

    /* sealed.json opened. Refused (422) without the passphrase or with one that doesn't open it, nothing changed. */
    public static JsObj Unseal(object? part, string? passphrase)
    {
        if (passphrase == null) throw new Refused("This backup is sealed with a passphrase: enter it to restore the keys or the whole database", 422);
        var unreadable = new Refused("The backup's sealed part is unreadable");
        if (part is not JsObj s || !Js.StrictEq(s["cipher"], Cipher) || !Js.StrictEq(s["kdf"], Kdf) || s["rounds"] is not double r || r < 1 || r > 10_000_000)
            throw unreadable;
        byte[] salt, nonce, data;
        try { (salt, nonce, data) = (Convert.FromBase64String(Js.Str(s["salt"])), Convert.FromBase64String(Js.Str(s["nonce"])), Convert.FromBase64String(Js.Str(s["data"]))); }
        catch (FormatException) { throw unreadable; }
        if (salt.Length < 16 || nonce.Length != 12 || data.Length < 16) throw unreadable;
        var plain = new byte[data.Length - 16];
        var key = SealKey(passphrase, salt, (int)r);
        try
        {
            using (var aes = new AesGcm(key, 16))
                aes.Decrypt(nonce, data.AsSpan(0, plain.Length), data.AsSpan(plain.Length), plain, SealLabel);
            return JsJson.Parse(Encoding.UTF8.GetString(plain)) as JsObj ?? throw unreadable;
        }
        catch (AuthenticationTagMismatchException) { throw new Refused("That passphrase doesn't open this backup", 422); }
        catch (JsError) { throw unreadable; }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
            CryptographicOperations.ZeroMemory(key);
        }
    }

    /*
     * A whole database's copy for a sealed backup: the keys out (they travel
     * sealed), and what a restore never takes from it. Deleted with
     * secure_delete, so the rows' bytes aren't left in the file's free pages.
     */
    public static void ScrubForSeal(string dbCopy)
    {
        using var d = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = dbCopy, Pooling = false }.ToString());
        d.Open();
        Run(d, "PRAGMA secure_delete = ON");
        using var tx = d.BeginTransaction();
        foreach (var t in KeepTables)
            if (Scalar(d, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $1", t) != null) Run(d, $"DELETE FROM {t}");
        foreach (var k in KeyKeys.Concat(KeepSettings)) Run(d, "DELETE FROM settings WHERE key = $1", k);
        tx.Commit();
    }

    /* A sealed backup's keys put into its database's copy, as the keys part puts them into the open one. */
    public static void PutKeys(string dbFile, JsObj keys)
    {
        using var d = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = dbFile, Pooling = false }.ToString());
        d.Open();
        var server = new JsObj { ["keys"] = keys };
        Apply(d, server, new HashSet<string> { "keys" }, null);
    }
}
