// IBroadcastUploadLater.cs — the files an upload has put off (item 488): one waited for (sent a short while ago,
// iBroadcast hasn't listed it yet) or left for now (taken, not kept), each with when it is looked at again. An upload
// can run for days (a first one of 140,000 files: 135 hours); what it put off at its start is looked at again as it
// goes, when its time comes, not at the next upload alone.
namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcastUploadLater
{
    /// <summary>A file put off: as it was sent, when it is looked at again, and whether it was left (said on the page) or only waited for.</summary>
    public sealed record Put(LocalFile F, IBroadcastUploadSent.Was W, double Due, bool Left);

    private readonly List<Put> off = [];

    /// <summary>[f], sent as [w], put off until [due].</summary>
    public void Add(LocalFile f, IBroadcastUploadSent.Was w, double due, bool left) { lock (off) off.Add(new(f, w, due, left)); }

    /// <summary>Those whose time has come at [now], taken out: each is handed to one asker only.</summary>
    public List<Put> Due(double now)
    {
        lock (off)
        {
            var due = off.Where(p => p.Due <= now).ToList();
            if (due.Count > 0) off.RemoveAll(p => p.Due <= now);
            return due;
        }
    }

    /// <summary>[those] put off again until [due]: iBroadcast couldn't be asked what it has.</summary>
    public void Back(IEnumerable<Put> those, double due) { lock (off) off.AddRange(those.Select(p => p with { Due = due })); }
}
