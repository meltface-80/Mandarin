// Signing.Expiring.cs — the addresses handed to speakers and players, signed until a time (item 368, the security
// audit's seventh finding).
//
// A signed address (Signing.cs) carried an HMAC of its path alone and never expired: one that leaked (a device's log,
// a screenshot, a proxy's) let its holder fetch that track or cover for good. Each address handed out now carries its
// expiry in its signature, s=<the 22 characters>.<Unix seconds, LinkDays on>, the 22 the HMAC of the path and that
// expiry: a changed expiry is a wrong signature, a past one is refused. In s, so an address is still its path, ?s= and
// its query as before, as the players, the queues and the recordings of what was sent take it. Thirty days, not one: a Sonos queue keeps the addresses it was
// given, and is played again from the Sonos app days later; what Mandarin plays again it gives new addresses.
//
// An address signed by the path alone, as every one was before, is taken for thirty days from the first start of the
// version that gives expiring ones (the linksLegacyUntil setting), so nothing queued stops at the update; after that,
// never. SignUrl and Gate are kept as the Node server had them (its rules' tests hold them so).
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

internal static partial class Signing
{
    /* How long an address handed out is good for. */
    public const int LinkDays = 30;

    /* What is signed for [path] good until [e]: the path and the expiry, so one can't be changed without the other. */
    public static string SigUntil(string secret, string path, string e) => Sig(secret, path + "\ne=" + e);

    /* [url] signed until [days] from now: e= and then s= added (the path as SignUrl takes it). */
    public static string SignExpiring(string secret, string url, int days = LinkDays) => SignUntil(secret, url, DateTimeOffset.UtcNow.ToUnixTimeSeconds() + days * 86400L);

    /* [url] signed until [until] (Unix seconds): s= the signature of the path and the expiry, a dot, the expiry. */
    public static string SignUntil(string secret, string url, long until)
    {
        var i = url.IndexOf("://", StringComparison.Ordinal);
        var start = i >= 0 ? url.IndexOf('/', i + 3) : 0;
        if (start < 0) start = Math.Max(0, url.Length - 1);
        var rest = url[start..];
        var q = rest.IndexOf('?');
        var pathOnly = q >= 0 ? rest[..q] : rest;
        var e = until.ToString(CultureInfo.InvariantCulture);
        Handed.Note(pathOnly, until);   // what a speaker may ask for by its own address (item 369)
        return url + (url.Contains('?') ? "&" : "?") + "s=" + SigUntil(secret, pathOnly, e) + "." + e;
    }

    /*
     * The gate's decision on an address by its signature (a speaker asking by its own address aside): one with an
     * expiry, its signature of the path and the expiry and the expiry not past; one by the path alone, as Gate decides
     * it and only while such addresses are still taken (LegacyTaken). false where it isn't signed so.
     */
    public static bool Signed(string secret, string? rawTarget, SqliteConnection c, long now)
    {
        if (Target(rawTarget) is not { } t || QueryS(t.Query) is not { } s) return false;
        if (s.Length <= 23 || s[22] != '.') return Gate(secret, rawTarget) == true && LegacyTaken(c, now);   // by the path alone, as before
        string sig = s[..22], e = s[23..];
        if (e.Length > 12 || !e.All(char.IsAsciiDigit) || !long.TryParse(e, out var until) || now >= until) return false;
        if (!sig.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '_' or '-')) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(sig), Encoding.ASCII.GetBytes(SigUntil(secret, t.Path, e)));
    }

    private static long legacyUntil;

    /* Whether an address signed by the path alone is still taken: for LinkDays from the first start of this version. */
    public static bool LegacyTaken(SqliteConnection c, long now)
    {
        if (legacyUntil == 0)
        {
            if (Db.Setting(c, "linksLegacyUntil") is { } v && double.TryParse(Js.Str(v), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && d > 0) legacyUntil = (long)d;
            else
            {
                legacyUntil = now + LinkDays * 86400L;
                using var cmd = c.CreateCommand();
                cmd.CommandText = "INSERT INTO settings(key, value) VALUES('linksLegacyUntil', $v) ON CONFLICT(key) DO NOTHING";
                cmd.Parameters.AddWithValue("$v", legacyUntil.ToString(CultureInfo.InvariantCulture));
                cmd.ExecuteNonQuery();
            }
        }
        return now < legacyUntil;
    }
}
