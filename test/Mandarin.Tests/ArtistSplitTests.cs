namespace Mandarin.Tests;

/// <summary>
/// An album's artist split into its acts (Names.SplitArtists; bug list item 136): "10,000 Maniacs" is one band, its
/// comma a number's, not a list's; it showed as an act called "10" (with another "10"'s picture and facts) and one
/// called "000 Maniacs". Commas between names still split, and the rules for "The" and "Jr." still hold.
/// </summary>
public sealed class ArtistSplitTests
{
    [Test]
    public async Task A_comma_inside_a_number_is_not_a_list_s()
    {
        var cases = new (string Credit, string[] Acts)[]
        {
            ("10,000 Maniacs", ["10,000 Maniacs"]),
            ("10,000 Maniacs feat. Michael Stipe", ["10,000 Maniacs", "Michael Stipe"]),
            ("Artist A, Artist B", ["Artist A", "Artist B"]),
            ("Sly, 100 Proof", ["Sly", "100 Proof"]),
            ("Room 1,99", ["Room 1", "99"]),
            ("Beatles, The", ["Beatles, The"]),
            ("Harry Connick, Jr.", ["Harry Connick, Jr."]),
        };
        var r = await Score.Run(new { fn = "split", names = cases.Select(c => c.Credit).ToArray() });
        var got = r["split"]!.AsArray();
        for (var i = 0; i < cases.Length; i++)
            Assert.Equal(cases[i].Acts, got[i]!.AsArray().Select(x => (string)x!).ToArray());
    }
}
