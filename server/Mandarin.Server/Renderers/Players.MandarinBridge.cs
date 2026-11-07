// Players.MandarinBridge.cs — a Mandarin Bridge renderer's own word on what it plays (MandarinBridge.cs): the
// verification Players.Commands.cs's Verify hands over for one.
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal sealed partial class Players
{
    /*
     * A Mandarin Bridge renderer says what it is feeding its DAC (/dac.json's "now", MandarinBridge.cs): the rate and depth
     * for PCM, the DSD multiple for DSD, natively or as DoP. The same as sent, and the track is confirmed (a PCM rate
     * and depth marked verified on its page); else the mismatch is said, as a WiiM's would be.
     */
    private async Task VerifyMandarinBridge(Player p, DeviceRecord rec, UpnpItem item, string baseUrl)
    {
        if (item.Sent == null || item.Sent.Rate == 0) return;
        var key = p.Index + ":" + item.Uri;
        lock (gate) { if (p.Verifying == key) return; }
        ZoneState? st;
        lock (zm.Gate) st = zm.State.GetValueOrDefault(p.Id);
        if ((st?.Position ?? 0) < 2) return;
        lock (gate) p.Verifying = key;
        var dac = await MandarinBridge.Probe(baseUrl);
        // Unanswered, or playing nothing it says (its app busy, between tracks): asked again at the next read (item 314),
        // where before this track was never asked again and its ✓ never came.
        if (dac == null) { lock (gate) if (p.Verifying == key) p.Verifying = null; Unanswered(p); return; }
        var now = MandarinBridge.Playing(dac);
        if (now == null) { lock (gate) if (p.Verifying == key) p.Verifying = null; return; }
        var dsd = item.Sent.Dsd;
        // The same format: the same rate and kind, in words at least as wide as the samples sent (16-bit samples in a
        // 32-bit word keep their values, item 287; before, a 16-bit track to a 32-bit DAC was never confirmed).
        var ok = dsd > 0 ? now.Dsd == dsd : now.Dsd == 0 && now.Rate == item.Sent.Rate && (now.Bits == 0 || item.Sent.Bits == 0 || now.Bits >= item.Sent.Bits);
        var fed = new Fed("Mandarin Bridge", now.Kind, now.Rate, now.Bits, now.Dsd, now.Volume, now.Level, now.Untouched, ok);
        if (ok && dsd == 0) { using var c = Db.Open(); Register.MarkVerified(c, p.Id, now.Rate, now.Bits != 0 ? now.Bits : item.Sent.Bits); }
        var bump = false;
        lock (zm.Gate) { if (zm.State.TryGetValue(p.Id, out var cur) && cur.TrackUri == item.Uri) { cur.Verified = ok ? "yes" : "no"; cur.Fed = fed; bump = true; } }
        if (bump) zm.Bump();
        if (!ok)
        {
            var sent = dsd > 0 ? $"DSD{Tags.Js.Num(dsd)}" : $"{Tags.Js.Num(item.Sent.Bits)}-bit/{Tags.Js.Num(item.Sent.Rate / 1000)} kHz";
            var got = now.Dsd > 0 ? $"DSD{Tags.Js.Num(now.Dsd)}" : $"{(now.Bits != 0 ? Tags.Js.Num(now.Bits) : "?")}-bit/{Tags.Js.Num(now.Rate / 1000)} kHz";
            var msg = $"Sent {sent}, the DAC is fed {got}";
            lock (gate) p.LastError = (Hub.Now(), msg);
            Log($"[renderers] {rec.Name ?? rec.NetworkName}: {msg}");
        }
    }
}
