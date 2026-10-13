// Scanner.Migrate.cs — the library's one-time upgrades (v0.8.50, stage 7
// part 5; lib/library/scanner.js's migrateKeys, migrateNames and
// migrateDiscs, which the Node server ran each time it started): an album's
// key gains its folder and every folder is regrouped (v0.6.0-RC8), the
// tracks whose tags name the artist and album are marked read so only the
// others are read again for names from their folders (v0.6.0-RC10), and a
// track in a disc folder with no disc number takes the folder's (v0.6.0).
// Each is marked done in the settings and never runs again; a new database
// is marked at its first scan. Run before each scan (ScanCommand.cs), since
// every scan the server makes is this program's.

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    /// <summary>The upgrades not yet made to this library, in the order the Node server made them.</summary>
    /// <param name="backupEdits">writes album-edits.json again once album keys have moved</param>
    public void Migrate(Action? backupEdits = null)
    {
        MigrateKeys(backupEdits);
        MigrateNames();
        MigrateDiscs();
    }

    private void MigrateKeys(Action? backupEdits)
    {
        if (Js.ToNumber(Setting("album_key_v", 1.0)) >= 2) return;
        var rows = All("SELECT id, key, dir FROM albums");
        Transaction(() =>
        {
            foreach (var r in rows)
            {
                var key = Js.Str(r["key"]);
                if (key.Split('\u0001').Length >= 3) continue;
                Rekey(key, key + "\u0001" + RelFolder(Js.Truthy(r["dir"]) ? Js.Str(r["dir"]) : ""));
            }
        });
        SetSetting("album_key_v", 2.0);
        SetSetting("album_regroup", true);
        backupEdits?.Invoke();
        if (rows.Count > 0) log($"[scan] albums are now told apart by their folder too: {rows.Count} keys updated; the next scan regroups every folder");
    }

    private void MigrateNames()
    {
        if (Js.ToNumber(Setting("names_v", 0.0)) >= 1) return;
        var others = Exec(@"UPDATE tracks SET tags_v = $v WHERE tags_v >= 1 AND tags_v < $v
      AND (COALESCE(artist, '') != '' OR COALESCE(album_artist, '') != '') AND COALESCE(album, '') != ''", ("$v", TagsV));
        var left = Js.ToNumber(Get("SELECT COUNT(*) AS n FROM tracks WHERE COALESCE(tags_v, 0) < $v", ("$v", TagsV))!["n"]);
        SetSetting("names_v", 1.0);
        if (left > 0) log($"[scan] {Js.Str(left)} tracks without an artist or album tag will be read again, their names taken from their folders ({others} others left as they are)");
    }

    private void MigrateDiscs()
    {
        if (Js.ToNumber(Setting("discs_v", 0.0)) >= 1) return;
        var n = 0;
        Transaction(() =>
        {
            foreach (var r in All("SELECT id, path FROM tracks WHERE disc_no IS NULL"))
            {
                var m = ScanNames.DiscDir().Match(NodePath.Basename(NodePath.Dirname(Js.Str(r["path"]))));
                if (!m.Success) continue;
                Exec("UPDATE tracks SET disc_no = $d WHERE id = $id", ("$d", double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture)), ("$id", r["id"]));
                n++;
            }
        });
        SetSetting("discs_v", 1.0);
        if (n > 0) log($"[scan] {n} tracks in disc folders given their folder's disc number");
    }
}
