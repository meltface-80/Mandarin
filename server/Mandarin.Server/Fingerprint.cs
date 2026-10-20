// Fingerprint.cs — SHA-1 and MD5 where nothing is secret (v0.9.2, the audit's
// S7, old/audit-b4-main.md): an answer's ETag (Http.cs, Pages.cs), a
// cover's fingerprint (Scan/Scanner.cs, AlbumEditRoutes.cs), a kept cover's
// file name (Services/Rows.cs), a sound device's id (Local/LocalDevices.cs),
// which keys found the label logos (Extras/LabelLogos.cs), a drawn cover's
// colour (CoversDrawn.cs), and the request signature Qobuz's API asks for
// (Services/QobuzApi.cs). The analyzers call both hashes weak, and they are
// for anything that must hold against an attacker; none of these must, and
// each has to stay as it is: the ids and fingerprints are stored, and Qobuz
// checks its signature. What protects something uses SHA-256 or better
// (Auth.cs, Admin/Backup.Seal.cs), and the analyzers refuse any other use of
// these two (.editorconfig).
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;

namespace Mandarin.Server;

internal static class Fingerprint
{
    /* SHA-1 of `data`, for one of the uses above. */
    [SuppressMessage("Security", "CA5350", Justification = "A fingerprint, nothing secret (the header says which).")]
    public static byte[] Sha1(byte[] data) => SHA1.HashData(data);

    /* MD5 of `data`, for one of the uses above. */
    [SuppressMessage("Security", "CA5351", Justification = "A fingerprint or Qobuz's signature, nothing secret (the header says which).")]
    public static byte[] Md5(byte[] data) => MD5.HashData(data);
}
