// IBroadcastUpload.cs — the library here uploaded to iBroadcast (item 446), by Upload now on its page: every file of
// the library's, or of the drive chosen (item 451, IBroadcastUploadChoices.cs), album by album, up to three at once as
// chosen (DSD and the over-large made FLAC one at a time), each as it is (IBroadcastUploadFiles.cs makes FLAC of DSD, and of a
// lossless file over iBroadcast's 1.5 GB). Local files stay where they are and as they are: never moved, changed or
// deleted; only read.
//   - Already there, not sent again: iBroadcast's MD5s of its files are asked first, and each file's checked against
//     them. What was sent is kept (the cache's "ibroadcast-upload": a file here, its size and time, the MD5 sent and
//     whether it was made FLAC: IBroadcastUploadSent.cs), so a file unchanged and still there isn't read again, nor a FLAC
//     made of it again; an upload stopped or cut off goes on where it was. One iBroadcast took twice and didn't keep
//     is left, with iBroadcast's words (item 477).
//   - While music of Mandarin's plays it waits, unless let go on at home or away from home, then with as many at once
//     as chosen for each (IBroadcastUploadChoices.Allowed); a file under way is finished.
//   - A format iBroadcast doesn't take (the account's formats, as it says them) is left, and said; so is one that
//     can't be made to fit, and one iBroadcast refused, with why.
// What it is doing, and what the last one did (the setting "ibroadcastUpload"), the page reads: files and bytes done
// and to go, the album now, the speed it sends at and the time left, and what was uploaded, already there, made FLAC,
// left or failed. When it has sent anything, the iBroadcast library is read again.
// Upload now goes on after the server restarts (item 467: an update restarts it): one under way when the server stops
// is noted (the setting "ibroadcastUploadResume"), and begun again as the server starts, going on where it was. One
// stopped by Stop upload, done, or ended by an error isn't; nor is one the schedule began (IBroadcastSchedule.cs
// begins it again itself while its window is open).
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastUpload(IBroadcast account, string dataDir)
{
    /// <summary>The last upload's summary, as Status says it.</summary>
    public const string StateKey = "ibroadcastUpload";
    /// <summary>Set while an Upload now is under way; left set when the server stops it, so it is begun again.</summary>
    public const string ResumeKey = "ibroadcastUploadResume";
    /// <summary>How often a noted upload is tried again as the server starts (a drive still mounting); ten minutes at most.</summary>
    public int ResumeEveryMs { get; init; } = 15_000;
    /// <summary>iBroadcast's limit on a file: 1.5 GB (the tests' ibroadcast_upload_limit).</summary>
    public long LimitBytes { get; init; } = 1_500_000_000;
    /// <summary>How often a hold for music playing is looked at again.</summary>
    public int HoldMs { get; init; } = 5000;
    // One FLAC made at a time, however many are sent at once.
    private readonly SemaphoreSlim making = new(1, 1);
    /// <summary>The file's sending (its waits the tests' shorter).</summary>
    public IBroadcastUploadFiles Files { get; init; } = new(account.Api, dataDir);

    private static readonly HashSet<string> Dsd = ["dsf", "dff"];
    private const int ListMost = 50;

    private readonly object gate = new();
    private CancellationTokenSource? stop;
    private Run? now;
    private bool shuttingDown;

    /* One upload's progress. */
    private sealed class Run
    {
        public double Started, Finished;
        public int FilesTotal, FilesDone, Uploaded, Already, Converted, Skipped, Failed;
        public long BytesTotal, BytesDone, Sent;
        public double SendingMs, SendingSince;
        public int Sending;
        public string? Album, File, Error, From, HeldWhere;
        public List<string> Drives = [];
        public bool Stopped;
        public readonly List<(string File, string Why)> Problems = [];
    }

    /// <summary>Whether an upload is under way.</summary>
    public bool Running { get { lock (gate) return now != null; } }

    /// <summary>The upload under way, or the last one's summary; null where there has been none.</summary>
    public JsonObject? Status()
    {
        lock (gate) if (now != null) return Said(now, true);
        using var c = Db.Open();
        return Db.Setting(c, StateKey) as JsonObject;
    }

    /// <summary>Upload now ([scheduled]: the schedule's): begun where none is under way.</summary>
    public void Start(bool scheduled = false)
    {
        if (!IBroadcast.Connected()) throw new ServiceError("Not signed in to iBroadcast", 401);
        var c = IBroadcastUploadChoices.Stored();
        if (!c.Chosen) throw new ServiceError("Choose what to upload from first: All drives or the drives to send", 409);
        // The drives chosen that are connected (item 472); one that isn't is left out, said, unless none is left.
        var drives = IBroadcastUploadChoices.DrivesNow(c, out var missing);
        if (drives.Count == 0)
            throw new ServiceError(c.All ? "No drive is connected to upload from" : $"{IBroadcastUploadChoices.NameOf(c)} isn't there: connect it, or choose again", 409);
        lock (gate)
        {
            if (now != null) return;
            if (missing.Count > 0) Server.Log($"[ibroadcast] upload: {string.Join(", ", missing.Select(IBroadcastUploadChoices.NameOf))} not connected: left out");
            now = new Run { Started = IBroadcastApi.Now(), From = IBroadcastUploadChoices.NameOf(c), Drives = drives };
            stop = new CancellationTokenSource();
            if (!scheduled) Note(true);
            var (run, token) = (now, stop.Token);
            _ = Task.Run(() => Go(run, token));
        }
    }

    /// <summary>The upload under way stopped, after the file it is on (that one sent again next time).</summary>
    public void Stop() { lock (gate) stop?.Cancel(); }

    /// <summary>The server stopping: the upload under way stopped as Stop does, but an Upload now noted to go on.</summary>
    public void Shutdown() { lock (gate) { shuttingDown = true; stop?.Cancel(); } }

    /// <summary>
    /// The server started: an Upload now it stopped (noted) begun again, going on where it was; tried again while it
    /// can't be yet (signed in still being read, the drive still mounting), ten minutes at most, then let go, said why.
    /// </summary>
    public void Resume() => _ = Task.Run(async () =>
    {
        using (var c = Db.Open()) if (Db.Setting(c, ResumeKey) is not JsonValue v || !v.TryGetValue<bool>(out var on) || !on) return;
        var tries = Math.Max(1, 600_000 / Math.Max(1, ResumeEveryMs));
        string why = "";
        for (int i = 0; i < tries; i++)
        {
            await Task.Delay(ResumeEveryMs);
            if (Running) return;
            try
            {
                Start();
                Server.Log("[ibroadcast] upload: begun again after the server restarted, going on where it was");
                return;
            }
            catch (ServiceError e) { why = e.Message; }
        }
        Note(false);
        Server.Log($"[ibroadcast] upload: couldn't go on after the server restarted: {why}");
    });

    /* Whether an Upload now is under way, kept: [on] as one begins, off as it ends but for the server stopping. */
    private static void Note(bool on)
    {
        try
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = on ? "INSERT INTO settings(key, value) VALUES($k, 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                : "DELETE FROM settings WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", ResumeKey);
            cmd.ExecuteNonQuery();
        }
        catch (Microsoft.Data.Sqlite.SqliteException e) { Server.Log("[ibroadcast] upload: couldn't note it: " + e.Message); }
    }

    private async Task Go(Run run, CancellationToken token)
    {
        Server.Log($"[ibroadcast] upload: begun, from {run.From}");
        using var all = CancellationTokenSource.CreateLinkedTokenSource(token);
        try
        {
            var have = await Files.Md5s(token);
            var files = IBroadcastUploadLocal.Of(run.Drives);
            var sent = IBroadcastUploadSent.All();
            var todo = new List<LocalFile>();
            var notKept = new List<(LocalFile F, IBroadcastUploadSent.Was W)>();
            foreach (var f in files)
            {
                if (!sent.TryGetValue(f.Path, out var r) || !IBroadcastUploadSent.Same(r, f)) todo.Add(f);
                else if (have.Contains(r.Md5)) run.Already++;
                else if (r.Taken >= IBroadcastUploadSent.TakenMost) notKept.Add((f, r));
                else todo.Add(f);
            }
            foreach (var (f, w) in notKept) Problem(run, f, IBroadcastUploadSent.Why(w), failed: false, log: false);
            run.FilesTotal = todo.Count;
            run.BytesTotal = todo.Sum(f => f.Size);
            Server.Log($"[ibroadcast] upload: {todo.Count} of {files.Count} files to look at, {run.Already} there already as sent before"
                + (notKept.Count > 0 ? $", {notKept.Count} left as iBroadcast took them {IBroadcastUploadSent.TakenMost} times but didn't keep them (from {Path.GetFileName(Path.GetDirectoryName(notKept[0].F.Path))})" : ""));
            var queue = new System.Collections.Concurrent.ConcurrentQueue<LocalFile>(todo);
            await Task.WhenAll(Enumerable.Range(0, IBroadcastUploadChoices.Most).Select(slot => Worker(slot, queue, have, sent, run, all)));
            run.Stopped = run.Error == null && token.IsCancellationRequested;
        }
        catch (OperationCanceledException) { run.Stopped = true; }
        catch (ServiceError e) { run.Error = e.Message; }
        finally
        {
            run.Finished = IBroadcastApi.Now();
            run.Album = run.File = run.HeldWhere = null;
            Save(Said(run, false));
            bool going;
            lock (gate) { going = shuttingDown; now = null; stop?.Dispose(); stop = null; }
            if (!going) Note(false);   // stopped by hand, done, or ended: not begun again
            else Server.Log("[ibroadcast] upload: the server is stopping; it goes on when the server starts again");
            Server.Log($"[ibroadcast] upload: {(run.Stopped ? "stopped" : run.Error != null ? "ended: " + run.Error : "done")}; {run.Uploaded} uploaded, {run.Already} there already, "
                + $"{run.Converted} made FLAC, {run.Skipped} left, {run.Failed} failed");
            // The fastest it has sent, kept to help say the home's upload speed (item 479).
            if (Said(run, false)["speed"] is JsonValue sp && sp.TryGetValue<double>(out var bps) && bps > 0) IBroadcastUploadSpeed.Seen(bps);
            if (run.Uploaded > 0 && Jobs.IBroadcastLibrary is { } lib) _ = Task.Run(async () =>
            {
                try { await lib.Read(true); } catch (ServiceError e) { Server.Log("[ibroadcast] the library couldn't be read: " + e.Message); }
            });
        }
    }

    /* One of the senders: the next file, while its place ([slot]) is let go on; the sign-in refused or a file not read, all of them ended. */
    private async Task Worker(int slot, System.Collections.Concurrent.ConcurrentQueue<LocalFile> queue, HashSet<string> have,
        Dictionary<string, IBroadcastUploadSent.Was> sent, Run run, CancellationTokenSource all)
    {
        try
        {
            while (true)
            {
                if (!await Turn(slot, run, queue, all.Token) || !queue.TryDequeue(out var f)) return;
                lock (run) { run.Album = f.Album; run.File = Path.GetFileName(f.Path); }
                try { await One(f, have, sent.GetValueOrDefault(f.Path), run, all.Token); }
                catch (IBroadcastUploadFiles.NotSent e) { Problem(run, f, e.Message, failed: true); }
                lock (run) { run.FilesDone++; run.BytesDone += f.Size; }
            }
        }
        catch (OperationCanceledException) { /* stopped, or another ended them */ }
        catch (Exception e) when (e is ServiceError or IOException)
        {
            lock (run) run.Error ??= e is IOException ? "A file couldn't be read: " + e.Message : e.Message;
            await all.CancelAsync();
        }
    }

    /*
     * Waited for until place [slot] may send: as many at once as music playing, or none, lets go on (the choices read
     * afresh each time). False once nothing is left to send: a place never let go on doesn't keep the upload waiting.
     */
    private async Task<bool> Turn(int slot, Run run, System.Collections.Concurrent.ConcurrentQueue<LocalFile> queue, CancellationToken token)
    {
        while (true)
        {
            token.ThrowIfCancellationRequested();
            if (queue.IsEmpty) return false;
            var (most, held) = IBroadcastUploadChoices.Allowed(IBroadcastUploadChoices.Stored());
            lock (run) run.HeldWhere = most == 0 ? held : null;
            if (slot < most) return true;
            await Task.Delay(HoldMs, token);
        }
    }

    /* One file ([was]: as sent before, if it was): left, already there, or sent (as it is, or made FLAC first). */
    private async Task One(LocalFile f, HashSet<string> have, IBroadcastUploadSent.Was? was, Run run, CancellationToken token)
    {
        if (!File.Exists(f.Path)) throw new IBroadcastUploadFiles.NotSent("The file isn't there");
        var ext = Path.GetExtension(f.Path).TrimStart('.').ToLowerInvariant();
        var dsd = Dsd.Contains(ext);
        var formats = (IBroadcast.Account()?["formats"] as JsonArray ?? []).Select(x => IBroadcastApi.Str(x)).OfType<string>().ToHashSet();
        if (!dsd && formats.Count > 0 && !formats.Contains(ext)) { Problem(run, f, $"iBroadcast doesn't take .{ext} files", failed: false); return; }
        string? made = null;
        try
        {
            if (dsd || f.Size > LimitBytes)
            {
                if (!dsd && !f.Lossless) throw new IBroadcastUploadFiles.NotSent("Over iBroadcast's limit of " + Gb(LimitBytes) + ", and not lossless, so not made smaller");
                // Its depth not known (a drive's file the library hasn't read): 24 bits, which keeps any up to it.
                var rate = dsd ? 176400L : f.Rate;
                await making.WaitAsync(token);
                try
                {
                    made = await Files.Flac(f.Path, rate, dsd || f.Bits == 0 ? 24 : f.Bits, token);
                    if (new FileInfo(made).Length > LimitBytes)
                    {
                        var own = IBroadcastUploadFiles.FlacRate(made);
                        File.Delete(made);
                        made = null;
                        // Its rate not known (a file of a drive the library hasn't read, item 455): the FLAC just made at it says it.
                        var half = (rate > 0 ? rate : own ?? 44100) / 2;
                        made = await Files.Flac(f.Path, half, dsd || f.Bits == 0 ? 24 : f.Bits, token);
                        if (new FileInfo(made).Length > LimitBytes) throw new IBroadcastUploadFiles.NotSent("Over iBroadcast's limit of " + Gb(LimitBytes) + " even as FLAC at half its rate");
                    }
                }
                finally { making.Release(); }
            }
            var send = made ?? f.Path;
            var md5 = await IBroadcastUploadFiles.Md5(send, token);
            bool there;
            lock (have) there = have.Contains(md5);
            if (there) { IBroadcastUploadSent.Note(f, md5, made != null, 0, null); lock (run) run.Already++; return; }
            // Sent before as it is, and iBroadcast hasn't it: taken and not kept (item 477), said with what iBroadcast said then.
            var taken = was != null && was.Md5 == md5 ? was.Taken : 0;
            if (taken > 0) Server.Log($"[ibroadcast] upload: {Path.GetFileName(f.Path)} was taken before but iBroadcast hasn't it"
                + (string.IsNullOrWhiteSpace(was!.Said) ? "" : $" (it said: \"{was.Said}\")") + "; sent again");
            // The speed is the bytes sent over the time any were being sent, however many at once.
            lock (run) if (run.Sending++ == 0) run.SendingSince = IBroadcastApi.Now();
            string said;
            try { said = await Files.Send(send, made != null ? Path.ChangeExtension(f.Path, ".flac") : f.Path, n => Interlocked.Add(ref run.Sent, n), token); }
            finally { lock (run) if (--run.Sending == 0) run.SendingMs += IBroadcastApi.Now() - run.SendingSince; }
            lock (have) have.Add(md5);
            IBroadcastUploadSent.Note(f, md5, made != null, taken + 1, said);
            lock (run) { run.Uploaded++; if (made != null) run.Converted++; }
        }
        finally { if (made != null) try { File.Delete(made); } catch (IOException) { /* the next upload's to clear */ } }
    }

    private static void Problem(Run run, LocalFile f, string why, bool failed, bool log = true)
    {
        lock (run) { if (failed) run.Failed++; else run.Skipped++; }
        // Read by the page's asks as it is added to: one at a time.
        lock (run.Problems) if (run.Problems.Count < ListMost) run.Problems.Add((f.Path, why));
        if (log) Server.Log($"[ibroadcast] upload: {Path.GetFileName(f.Path)} {(failed ? "failed" : "left")}: {why}");
    }

    // iBroadcast's limit in words: "1.5 GB" (the tests' "2 MB").
    private static string Gb(long bytes) => bytes >= 1e9
        ? (bytes / 1e9).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " GB"
        : (bytes / 1e6).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " MB";

    /* What the page is told of [run]. */
    private static JsonObject Said(Run run, bool running)
    {
        double ms;
        lock (run) ms = run.SendingMs + (run.Sending > 0 ? IBroadcastApi.Now() - run.SendingSince : 0);
        var speed = ms > 1000 ? Interlocked.Read(ref run.Sent) / (ms / 1000) : 0;
        return new JsonObject
        {
            ["running"] = running, ["held"] = run.HeldWhere != null, ["held_where"] = run.HeldWhere, ["from"] = run.From,
            ["started"] = run.Started, ["finished"] = running ? null : run.Finished,
            ["files_total"] = run.FilesTotal, ["files_done"] = run.FilesDone, ["bytes_total"] = run.BytesTotal, ["bytes_done"] = run.BytesDone,
            ["album"] = run.Album, ["file"] = run.File, ["speed"] = Math.Round(speed),
            ["eta"] = running && speed > 0 ? Math.Round((run.BytesTotal - run.BytesDone) / speed) : null,
            ["uploaded"] = run.Uploaded, ["already"] = run.Already, ["converted"] = run.Converted, ["skipped"] = run.Skipped, ["failed"] = run.Failed,
            ["problems"] = Problems(run),
            ["stopped"] = run.Stopped, ["error"] = run.Error,
        };
    }

    private static JsonArray Problems(Run run)
    {
        lock (run.Problems) return new JsonArray([.. run.Problems.Select(p => (JsonNode)new JsonObject { ["file"] = p.File, ["why"] = p.Why })]);
    }

    // ---------------------------------------------------------------- what the last one did

    private static void Save(JsonObject summary)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", StateKey);
        cmd.Parameters.AddWithValue("$v", summary.ToJsonString());
        cmd.ExecuteNonQuery();
    }
}
