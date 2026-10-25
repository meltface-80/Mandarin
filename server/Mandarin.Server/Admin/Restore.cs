// Restore.cs — a database put back from a backup goes in at the next start
// (v0.8.50, stage 7; lib/backup.js swapStaged, which the Node server ran as
// it started): the one there is kept aside in backups/, the album edits'
// copy beside it is let go (the restored database carries its own), and the
// staged file takes its place. Before the database is opened (Program.cs).
namespace Mandarin.Server.Admin;

internal static partial class Backup
{
    /* The staged database swapped in; false when none is staged. */
    public static bool SwapStaged(string dataDir, Action<string> log)
    {
        var staged = Path.Combine(dataDir, "restore-staged.db");
        if (!File.Exists(staged)) return false;
        var file = Path.Combine(dataDir, "musicd.db");
        // No connection of the pool's left holding the file put aside (Db.cs).
        Db.LetGo();
        var dir = Path.Combine(dataDir, "backups");
        Directory.CreateDirectory(dir);
        var aside = Path.Combine(dir, $"before-restore-{Stamp(DateTime.Now)}.db");
        foreach (var suffix in new[] { "", "-wal", "-shm" })
            if (File.Exists(file + suffix)) File.Move(file + suffix, aside + suffix, overwrite: true);
        try { File.Delete(Path.Combine(dataDir, "album-edits.json")); } catch (IOException) { /* none */ }
        File.Move(staged, file, overwrite: true);
        log($"[backup] restored the database from a backup; the one before it is kept as {aside}");
        return true;
    }

    /* lib/backup.js stamp(): 2026-10-13-001234, on this clock. */
    private static string Stamp(DateTime d) => $"{d.Year}-{d.Month:00}-{d.Day:00}-{d.Hour:00}{d.Minute:00}{d.Second:00}";
}
