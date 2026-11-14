// Backup.Copies.cs — the copies of the database kept in backups/ beside the
// backups, restorable from Backup & restore (bug list item 410): the one a
// restore puts aside as it swaps the restored database in (Restore.cs,
// before-restore-<stamp>.db), and the one Mandarin OS's reinstaller makes
// before it switches builds where the Mandarin it finds makes no backup itself
// (os/…/reinstall-mandarin: before-dev-<stamp>.db, before-latest-<stamp>.db).
// Each is the database alone, no settings file, no Tailscale identity: put
// back as a backup's whole database is (StageDatabase: today's account,
// sign-ins and Tailscale identity kept, swapped in at the next start, the one
// there kept aside in its turn). Listed, restored and deleted by their names.
using System.Globalization;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

internal static partial class Backup
{
    /// <summary>The copies of the database kept in a data folder's backups/.</summary>
    public sealed class Copies(string dataDir)
    {
        private static readonly string[] Beside = ["", "-wal", "-shm"];

        /// <summary>Where they are.</summary>
        public readonly string Dir = Path.Combine(dataDir, "backups");

        /// <summary>
        /// Every copy, newest first: { id, kind (restore, dev or latest: what came after it), created, bytes, parts:
        /// ["database"] }.
        /// </summary>
        public List<JsObj> List()
        {
            string[] names;
            try { names = Directory.GetFiles(Dir).Select(Path.GetFileName).OfType<string>().Where(n => CopyName().IsMatch(n)).ToArray(); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
            var list = new List<(double Created, JsObj O)>();
            foreach (var n in names)
            {
                var m = CopyName().Match(n);
                var file = Path.Combine(Dir, n);
                var o = new JsObj();
                o["id"] = n[..^3];
                o["kind"] = m.Groups[1].Value;
                o["created"] = Created(m.Groups[2].Value, file);
                o["bytes"] = (double)Beside.Sum(s => System.IO.File.Exists(file + s) ? new FileInfo(file + s).Length : 0);
                o["parts"] = new List<object?> { "database" };
                list.Add(((double)o["created"]!, o));
            }
            return [.. list.OrderByDescending(x => x.Created).Select(x => x.O)];
        }

        /// <summary>The copy's file, or null: none by that name.</summary>
        public string? File(string id)
        {
            if (!CopyName().IsMatch(id + ".db")) return null;
            var f = Path.Combine(Dir, id + ".db");
            return System.IO.File.Exists(f) ? f : null;
        }

        /// <summary>The copy deleted, the files beside it with it; false when there was none.</summary>
        public bool Remove(string id)
        {
            if (File(id) is not { } f) return false;
            foreach (var s in Beside) if (System.IO.File.Exists(f + s)) System.IO.File.Delete(f + s);
            return true;
        }

        /// <summary>
        /// The copy readied to replace the open database (<paramref name="currentFile"/>) at the next start, as a
        /// backup's whole database is: copied out whole (its write-ahead log with it) to <paramref name="tmp"/>, then staged.
        /// </summary>
        public string Stage(string id, string currentFile, string tmp)
        {
            var f = File(id) ?? throw new Refused("No such backup", 404);
            foreach (var s in Beside.Take(2))
                if (System.IO.File.Exists(f + s)) System.IO.File.Copy(f + s, tmp + s, overwrite: true);
                else if (System.IO.File.Exists(tmp + s)) System.IO.File.Delete(tmp + s);
            try { return StageDatabase(tmp, currentFile, dataDir, null); }
            finally { foreach (var s in Beside.Skip(1)) try { System.IO.File.Delete(tmp + s); } catch (IOException) { /* gone */ } }
        }

        // When it was made: the time in its name (the server's clock), else the file's.
        private static double Created(string stamp, string file)
        {
            if (DateTime.TryParseExact(stamp, "yyyy-MM-dd-HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var at))
                return new DateTimeOffset(at).ToUnixTimeMilliseconds();
            return new DateTimeOffset(System.IO.File.GetLastWriteTimeUtc(file)).ToUnixTimeMilliseconds();
        }
    }

    [GeneratedRegex("^before-(restore|dev|latest)-([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6})\\.db\\z")]
    private static partial Regex CopyNameRx();
    private static Regex CopyName() => CopyNameRx();
}
