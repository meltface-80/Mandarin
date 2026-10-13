// Auth.Media.cs — the gate's reading of a stream's or a cover's address when
// there is no Node server to decide it (v0.8.50, stage 7 part 4; auth.js
// gate): an address signed under the install's secret, or asked for from one
// of the speakers' own addresses, passes; anything else needs the account's
// device like the rest, and is 401 without it (Auth.cs Gate). Behind a Node
// server the media addresses go through to it, as before.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Auth
{
    /* Signed, or a speaker asking: through the gate with no device. */
    private static async Task<bool> MediaAllowed(HttpContext ctx)
    {
        using (SqliteConnection c = Db.Open()) if (Images.Signed(ctx, c)) return true;
        return await Images.FromSpeaker(ctx);
    }
}
