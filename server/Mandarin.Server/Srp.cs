// Srp.cs — the server's half of SRP-6a, as public/srp.js does it (RFC 5054's
// 2048-bit group, SHA-256). The page, the Android app (Srp.kt) and this must
// agree to the byte: test/srp.test.js checks this one against
// test/srp-vector.json through `mandarin-server --srp-vector`.
//
//   B = k·v + g^b     k = H(N | PAD(g))     u = H(PAD(A) | PAD(B))
//   S = (A·v^u)^b     K = H(PAD(S))   M1 = H(PAD(A) | PAD(B) | K)   M2 = H(PAD(A) | M1 | K)
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;

namespace Mandarin.Server;

internal static class Srp
{
    public const int Iterations = 100000;
    private const int NLen = 256;

    private static readonly BigInteger N = Big(
        "AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D" +
        "CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF74" +
        "7359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D" +
        "5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6" +
        "94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73");
    private static readonly BigInteger G = 2;
    private static readonly BigInteger K = FromBytes(H(Pad(N), Pad(G)));

    public sealed record Start(BigInteger B_, BigInteger V, string B);
    public sealed record Result(bool Ok, string? M2);

    /* "  Someone " → "someone", as the page does. */
    public static string NormUser(string? s) => (s ?? "").Trim().ToLowerInvariant();

    /* The server's half, from the stored verifier. b is random unless given. */
    public static Start ServerStart(string verifierHex, string? bHex = null)
    {
        var v = Big(verifierHex);
        var b = bHex != null ? Big(bHex) : FromBytes(RandomNumberGenerator.GetBytes(32));
        var B = (K * v + BigInteger.ModPow(G, b, N)) % N;
        return new Start(b, v, Hex(Pad(B)));
    }

    /* The device's proof checked: ok, and the server's proof (M2). */
    public static Result ServerVerify(Start start, string aHex, string m1Hex)
    {
        BigInteger A;
        try { A = Big(aHex); } catch { return new Result(false, null); }
        if (A % N == 0) return new Result(false, null);
        var B = Big(start.B);
        var u = FromBytes(H(Pad(A), Pad(B)));
        if (u == 0) return new Result(false, null);
        var S = BigInteger.ModPow(A * BigInteger.ModPow(start.V, u, N) % N, start.B_, N);
        var k = H(Pad(S));
        var m1 = H(Pad(A), Pad(B), k);
        var given = (m1Hex ?? "").ToLowerInvariant();
        var mine = Hex(m1);
        if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(mine), System.Text.Encoding.ASCII.GetBytes(given)))
            return new Result(false, null);
        return new Result(true, Hex(H(Pad(A), m1, k)));
    }

    // ------------------------------------------------------------ helpers

    private static byte[] H(params byte[][] parts)
    {
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var p in parts) sha.AppendData(p);
        return sha.GetHashAndReset();
    }

    // Big-endian, at least NLen bytes (left-padded with zeros).
    private static byte[] Pad(BigInteger n)
    {
        var b = n.ToByteArray(isUnsigned: true, isBigEndian: true);
        if (b.Length >= NLen) return b;
        var p = new byte[NLen];
        Buffer.BlockCopy(b, 0, p, NLen - b.Length, b.Length);
        return p;
    }

    private static BigInteger FromBytes(byte[] b) => new(b, isUnsigned: true, isBigEndian: true);

    public static BigInteger Big(string hex)
    {
        var s = hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? hex[2..] : hex;
        if (s.Length == 0) return BigInteger.Zero;
        if (!s.All(Uri.IsHexDigit)) throw new FormatException("bad hex");
        return BigInteger.Parse("0" + s, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
    }

    public static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();
}
