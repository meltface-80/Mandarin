// PackStore.Installed.cs — a new MusicBrainz pack in place, said (bug list item 414b): the download kept as the pack
// (Pack.cs, DownloadNow), the setting that one was chosen written, and whoever listens told — the identification scan,
// which looks again at the albums it couldn't place or only proposed (Identifier.Review.cs, PackUpdated).
using System.Text.Json.Nodes;

namespace Mandarin.Server.Identify;

internal sealed partial class PackStore
{
    /* A new pack is in place. */
    public event Action? Installed;

    /* The pack downloaded is the one kept: so set, and said. */
    private void Kept()
    {
        SetSetting("mbpack", JsonValue.Create(true));
        try { Installed?.Invoke(); }
        catch (Exception e) { log("MusicBrainz pack: " + e.Message); }
    }
}
