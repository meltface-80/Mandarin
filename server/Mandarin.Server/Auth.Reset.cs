// Auth.Reset.cs — `mandarin-server reset-password` (v0.8.50, stage 7 part 2 of
// old/csharp-migration.md), from reset-password.js: forgot the
// password? Run on the server:
//
//     docker exec musicd-server /app/server/bin/mandarin-server reset-password
//
// It removes the account and signs every device out. Nothing else changes:
// the library, the edits, playlists and history all stay. Then open Mandarin
// from a device on the home network and create the account again. The
// running server needs no restart: its gate reads the database on each
// request.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Auth
{
    /* The account and the devices removed from <dataDir>/musicd.db; what was done, said. 0, or 1 when the database couldn't be changed. */
    public static int ResetPasswordCommand(string dataDir)
    {
        Db.File = Path.Combine(dataDir, "musicd.db");
        string? had = null;
        int devices = 0;
        try
        {
            if (File.Exists(Db.File))
            {
                using var c = Db.Open();
                using (var q = c.CreateCommand()) { q.CommandText = "SELECT username FROM account WHERE id = 1"; had = q.ExecuteScalar() as string; }
                using (var d = c.CreateCommand()) { d.CommandText = "DELETE FROM devices"; devices = d.ExecuteNonQuery(); }
                using (var a = c.CreateCommand()) { a.CommandText = "DELETE FROM account"; a.ExecuteNonQuery(); }
            }
        }
        catch (SqliteException e)
        {
            Console.Error.WriteLine($"The database at {Db.File} couldn't be changed: {e.Message}");
            return 1;
        }
        Console.WriteLine(had != null ? $"The account \"{had}\" was removed and {devices} device(s) signed out." : "There was no account to remove.");
        Console.WriteLine("Open Mandarin on a device on your home network to create the account again.");
        return 0;
    }
}
