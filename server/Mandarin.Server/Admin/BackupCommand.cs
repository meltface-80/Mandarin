// BackupCommand.cs — `mandarin-server backup <label>` (item 405): a backup of everything, kept in the data folder's
// backups (Settings → Backup lists it, and restores from it), made as the page's own are (Backup.Make.cs), while the
// server runs or not. Mandarin OS's Reinstall Mandarin makes one before it moves Mandarin between its releases and dev's
// builds, so a database a newer build has written is kept as it was, whatever the other makes of it. The data folder is
// DATA_DIR's, as the server's. Its record, a line of JSON, on standard output; 0 when made, 0 with nothing made where there
// is no database yet, 1 when it can't be made.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Admin;

internal static class BackupCommand
{
    public static async Task<int> Run(string dataDir, string label, string version)
    {
        var file = Path.Combine(dataDir, "musicd.db");
        if (!File.Exists(file))
        {
            Console.WriteLine(new JsonObject { ["ok"] = true, ["made"] = false, ["why"] = "no database: nothing to back up" }.ToJsonString());
            return 0;
        }
        Db.File = file;
        var all = Backup.Parts.ToDictionary(p => p, _ => true);
        try
        {
            var meta = await Backup.Keep(new Backup.Maker(dataDir, version, Path.Combine(dataDir, "tailscale", "tailscaled.state")),
                new Backup.From(label, null), all, null, null, "auto", label);
            Console.WriteLine(Tags.Js.Json(meta));
            return 0;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException or Backup.Refused)
        {
            Console.WriteLine(new JsonObject { ["ok"] = false, ["error"] = e.Message }.ToJsonString());
            return 1;
        }
    }
}
