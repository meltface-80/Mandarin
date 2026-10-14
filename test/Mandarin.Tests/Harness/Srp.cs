using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace Mandarin.Tests;

/// <summary>
/// The device's half of SRP-6a (RFC 5054's 2048-bit group, SHA-256), as public/srp.js and the Android
/// app's Srp.kt do it, for signing in from the tests:
///   x = H(salt | H(username | ":" | PBKDF2(password, salt, iterations, 32))),  v = g^x
///   A = g^a,  u = H(PAD(A) | PAD(B)),  S = (B − k·g^x)^(a + u·x)
///   K = H(PAD(S)),  M1 = H(PAD(A) | PAD(B) | K),  M2 = H(PAD(A) | M1 | K)
/// test/Mandarin.Tests/SrpTests.cs holds it to the fixed vector the three others agree on.
/// </summary>
public static class Srp
{
    private static readonly BigInteger N = Big(
        "AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D" +
        "CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF74" +
        "7359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D" +
        "5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6" +
        "94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73");
    private static readonly BigInteger G = 2;
    private const int NLen = 256;
    private static readonly BigInteger K = FromBytes(H(Pad(N), Pad(G)));

    /// <summary>The device's start: a (random unless given, hex) and A (hex, padded).</summary>
    public sealed record Start(BigInteger A_, string A);

    /// <summary>The device's proof: M1 to send, the M2 the server must answer with, and the shared key.</summary>
    public sealed record Proof(string M1, string ExpectM2, string K);

    /// <summary>Account creation: the salt (random unless given) and the verifier, hex.</summary>
    public static (string Salt, string Verifier) MakeVerifier(string username, string password, int iterations, string? saltHex = null)
    {
        var salt = saltHex ?? Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var x = PrivateKey(username, password, salt, iterations);
        return (salt, Convert.ToHexStringLower(Pad(BigInteger.ModPow(G, x, N))));
    }

    /// <summary>The device's half: a random a unless given.</summary>
    public static Start ClientStart(string? aHex = null)
    {
        var a = aHex != null ? Big(aHex) : FromBytes(RandomNumberGenerator.GetBytes(32));
        return new Start(a, Convert.ToHexStringLower(Pad(BigInteger.ModPow(G, a, N))));
    }

    /// <summary>With the server's salt and B: the proof. Throws on a bad B, as srp.js does.</summary>
    public static Proof ClientProof(string username, string password, string saltHex, int iterations, Start start, string bHex)
    {
        var b = Big(bHex);
        if (b % N == 0) throw new InvalidOperationException("bad server value");
        var a = Big(start.A);
        var u = FromBytes(H(Pad(a), Pad(b)));
        if (u == 0) throw new InvalidOperationException("bad server value");
        var x = PrivateKey(username, password, saltHex, iterations);
        var baseV = Mod(b - K * BigInteger.ModPow(G, x, N) % N, N);
        var s = BigInteger.ModPow(baseV, start.A_ + u * x, N);
        var key = H(Pad(s));
        var m1 = H(Pad(a), Pad(b), key);
        var m2 = H(Pad(a), m1, key);
        return new Proof(Convert.ToHexStringLower(m1), Convert.ToHexStringLower(m2), Convert.ToHexStringLower(key));
    }

    private static BigInteger PrivateKey(string username, string password, string saltHex, int iterations)
    {
        var salt = Convert.FromHexString(saltHex);
        var stretched = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32);
        var user = Encoding.UTF8.GetBytes(username.Trim().ToLowerInvariant());
        return FromBytes(H(salt, H(user, Encoding.UTF8.GetBytes(":"), stretched)));
    }

    private static byte[] H(params byte[][] parts) => SHA256.HashData([.. parts.SelectMany(p => p)]);
    private static BigInteger Mod(BigInteger v, BigInteger m) => (v % m + m) % m;
    private static BigInteger Big(string hex) => BigInteger.Parse("0" + hex, System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture);
    private static BigInteger FromBytes(byte[] b) => new(b, isUnsigned: true, isBigEndian: true);

    private static byte[] Pad(BigInteger n)
    {
        var b = n.ToByteArray(isUnsigned: true, isBigEndian: true);
        if (b.Length >= NLen) return b;
        var p = new byte[NLen];
        b.CopyTo(p, NLen - b.Length);
        return p;
    }
}
