// Auth.Secret.cs — the install's secret (v0.8.50, stage 7 part 1 of
// old/csharp-migration.md). lib/server/auth.js made it as the Node
// server started: a per-install secret for the addresses handed to speakers
// (Playback/Signing.cs: a speaker can't sign in, so its address carries a
// signature under it) and for the decoy salts (Auth.cs Decoy). With no Node
// server it is made here, at the start, before anything is signed (Program.cs).
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Auth
{
    /* The authSecret setting, made when none is there: 32 random bytes as hex, as auth.js wrote it. */
    public static void EnsureSecret()
    {
        using var c = Db.Open();
        if (Db.Setting(c, "authSecret") is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0) return;
        Playback.QueueStore.SetSetting(c, "authSecret", JsonValue.Create(Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant()));
    }
}
