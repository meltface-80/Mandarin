// Scanner.Again.cs — Edit album's Look at this album again (bug list item 424): only this album's folders read again
// from their files, every tag, and grouped from scratch as a scan would group them (a hand split and a join kept to),
// so a fix needn't wait for a whole scan. An album whose tracks are in two folders comes apart by folder first, as the
// scan does (Scanner.Split.cs). A track whose file is gone is left for the scan, which decides what is gone.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Scan;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Scanner
{
    /* The album at [albumId] read again and grouped from scratch; the albums its tracks are in now, the biggest first. */
    public List<double> LookAgain(double albumId)
    {
        claimed = [];
        var dirs = DirsOf(albumId);
        var paths = All("SELECT path FROM tracks WHERE album_id = $id", ("$id", albumId)).Select(r => Js.Str(r["path"])).ToList();
        var touched = new OrderedIds();
        touched.Add(albumId);
        Transaction(() => { foreach (var m in SplitByFolder(albumId, PosixFs.Exists)) touched.Add(m); });
        using var readers = new Readers(Math.Max(1, slots));
        foreach (var dir in dirs.Where(PosixFs.Exists))
        {
            var files = AudioIn(dir);
            var read = readers.Read(files);
            var full = new List<JsObj>();
            for (var i = 0; i < files.Count; i++)
            {
                var file = files[i];
                var prev = Get("SELECT id, path, mtime, size, album_id, year, date, tags_v FROM tracks WHERE path = $p", ("$p", file));
                var (tags, error) = read[i];
                if (tags == null || !PosixFs.TryStat(file, follow: true, out var st))
                {
                    log($"[scan] could not read {file}: {error}");
                    if (prev != null && Get("SELECT * FROM tracks WHERE path = $p", ("$p", file)) is { } kept) full.Add(Unchanged(kept));
                    continue;
                }
                if (Js.Truthy(tags["tagged"])) ScanNames.Fill(tags, file, Roots(), (JsObj)tags["tagged"]!);
                var row = new JsObj();
                row["path"] = file;
                row["mtime"] = Math.Floor(st.MtimeMs);
                row["size"] = st.Size;
                row["prev_album"] = prev?["album_id"];
                foreach (var k in tags.Keys) row[k] = tags[k];
                full.Add(row);
                paths.Add(file);
            }
            if (full.Count == 0) continue;
            Regroup(dir, full, touched, p => Get("SELECT id, path, mtime, size, album_id, year, date, tags_v FROM tracks WHERE path = $p", ("$p", p)) is { } r ? new Known(r) : null,
                null, biggestFirst: true);
        }
        Transaction(() => Settle(touched));
        return AlbumsOf(paths.Distinct(StringComparer.Ordinal));
    }

    /* The audio files of album folder [dir]: its own and its disc folders' ("CD1", "Disc 2"), by name. */
    private static List<string> AudioIn(string dir)
    {
        var files = new List<string>();
        void Add(string d, bool discs)
        {
            List<Entry> entries;
            try { entries = PosixFs.ReadDir(d); } catch (IOException) { return; }
            foreach (var e in entries)
            {
                if (e.Name.StartsWith('.')) continue;
                var full = NodePath.Join(d, e.Name);
                bool isDir = e.Type == EntryType.Dir, isFile = e.Type == EntryType.File;
                if (e.Type == EntryType.Link && PosixFs.TryStat(full, follow: true, out var st)) { isDir = st.IsDirectory; isFile = st.IsFile; }
                if (isDir && discs && ScanNames.DiscDir().IsMatch(e.Name)) Add(full, false);
                else if (isFile && AudioExt.Contains(Js.Lower(NodePath.Extname(e.Name)))) files.Add(full);
            }
        }
        Add(dir, true);
        files.Sort(string.CompareOrdinal);
        return files;
    }
}
