// ReleaseKey.cs — the public half of the key Mandarin's releases are signed with (item 371, the security audit's ninth
// finding), so an update is checked against more than a checksum published beside it. The Linux Bridge's copy: the
// server's (server/Mandarin.Server/Admin/ReleaseKey.cs) is the same key, and test/release-signing.test.js holds them so.
//
// The checksum (the server's mandarin-server.sha256, the Bridge's sidecar) catches a download broken on the way, not a
// release replaced by someone who can write to the repository or the account: they would replace its checksum with it.
// A signature can only be made with the private half of the key, which is kept by Mandarin's owner and in the release
// workflows' secret (RELEASE_SIGNING_KEY), never in the repository. Each program carries the public half: an update
// whose download isn't signed by it is refused. Empty until a key is made (tools/release-key.sh); until then, the
// checksum alone, as before. UPDATE_KEY gives another (the tests' own), as UPDATE_API says another GitHub.
//
// The signature is ECDSA P-256 over SHA-256 (openssl dgst -sha256 -sign), DER: the server's in <file>.sig beside the
// file (.github/sign.sh), the Bridge's tarball's, base64, in its sidecar's "sig" (bridge/sidecar.sh).
using System.Security.Cryptography;

namespace Mandarin.Bridge;

internal static class ReleaseKey
{
    /* The public key, base64 of its DER SubjectPublicKeyInfo (openssl ec -pubout -outform DER | base64). */
    public const string BuiltIn = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWPo7em6WGTi2IICIB2POcOia7Hc/jFNK6MPlL1MQn4huS0EYMTfqkpxyaqL8hXOk297sBISqi0j463Tr+NZFXQ==";

    /* The key updates are checked against, or null where there is none. */
    public static string? Current =>
        Environment.GetEnvironmentVariable("UPDATE_KEY") is { Length: > 0 } k ? k : BuiltIn.Length > 0 ? BuiltIn : null;

    /* Whether [sig] (DER) is [key]'s signature of [data]. */
    public static bool Verify(string key, byte[] data, byte[] sig)
    {
        try
        {
            using var ec = ECDsa.Create();
            ec.ImportSubjectPublicKeyInfo(Convert.FromBase64String(key), out _);
            return ec.VerifyData(data, sig, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
        }
        catch (Exception e) when (e is CryptographicException or FormatException) { return false; }
    }
}
