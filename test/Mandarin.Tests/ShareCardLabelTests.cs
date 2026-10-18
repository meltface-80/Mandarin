namespace Mandarin.Tests;

/// <summary>
/// The share card carries no record label (v1.0.7). It rode on the release line, and a long label ran off
/// the card's edge. The card for an album with a label, however long, is now the card for the same album
/// without one, to the byte; and the page no longer gathers the label for it.
/// </summary>
public sealed class ShareCardLabelTests
{
    private const string Draw = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => typeof ShareCard !== "undefined" && document.querySelector("#home-random .album, #home-today .album"));
          const sleeve = document.createElement("canvas"); sleeve.width = sleeve.height = 400;
          sleeve.getContext("2d").fillStyle = "#357"; sleeve.getContext("2d").fillRect(0, 0, 400, 400);
          const card = async (extra) => {
            const blob = await ShareCard.render(Object.assign({ coverUrl: sleeve.toDataURL(), logoUrl: null, wordmarkUrl: null,
              title: "White Sky", artist: "Peter Green", releaseRaw: "1982-05-01" }, extra));
            const b = new Uint8Array(await blob.arrayBuffer());
            let h = 0; for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]) | 0;
            return b.length + ":" + h;
          };
          return { plain: await card({}), label: await card({ label: "The Extremely Long Name Of An Independent Record Label Ltd" }),
            fields: Object.keys(cardFields({ album: { label: "Sanctuary", year: 1982 } })) };
        })()
        """;

    [Test]
    public async Task The_card_for_an_album_with_a_label_is_the_card_without_one()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }]);
        var r = (await page.Eval(Draw))!;
        Assert.Equal((string?)r["plain"], (string?)r["label"]);
        Assert.DoesNotContain("labelText", r["fields"]!.AsArray().Select(x => (string?)x));
        Assert.Empty(page.Errors);
    }
}
