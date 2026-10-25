using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// The play history read from an index (Schema.Indexes.cs): every query the server makes of its plays, as written in
/// its code and planned by SQLite on the database the server makes, reads by an album, by a time, or from an index
/// alone; never every play's row, as it did through plays(album_id) for "album_id IS NOT NULL" (46–105 ms on 40,000
/// plays). Home's history by time (plays_ts); Not played, Most played and the radio from plays_album_ts. And what
/// they answer, the same as before.
/// </summary>
public sealed partial class PlayHistoryIndexTests
{
    // A query of the plays, written whole on one line in the server's code.
    [GeneratedRegex("\"(SELECT [^\"\\n]*\\bFROM plays\\b[^\"\\n]*)\"")] private static partial Regex Sql();
    [GeneratedRegex(@"\$\w+")] private static partial Regex Param();

    private static List<string> Plan(SqliteConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "EXPLAIN QUERY PLAN " + sql;
        foreach (var p in Param().Matches(sql).Select(m => m.Value).Distinct()) cmd.Parameters.AddWithValue(p, 0);
        using var r = cmd.ExecuteReader();
        var lines = new List<string>();
        while (r.Read()) lines.Add(r.GetString(3));
        return lines;
    }

    [Test]
    public async Task Every_query_of_the_plays_reads_by_album_by_time_or_from_an_index_alone()
    {
        Needs.Server();
        var dir = Directory.CreateTempSubdirectory("mandarin-plays-").FullName;
        Assert.Equal(0, (await ServerCommand.Run(["db", dir])).Code);
        var queries = Directory.EnumerateFiles(Path.Combine(ServerProcess.Root, "server", "Mandarin.Server"), "*.cs", SearchOption.AllDirectories)
            .SelectMany(f => Sql().Matches(File.ReadAllText(f)).Select(m => m.Groups[1].Value)).Distinct().ToList();
        using var c = new SqliteConnection("Data Source=" + Path.Combine(dir, "musicd.db") + ";Mode=ReadOnly;Pooling=False");
        c.Open();
        var plans = queries.ToDictionary(q => q, q => Plan(c, q));
        static bool Bounded(string line) => !line.Contains("plays", StringComparison.Ordinal) || line.Contains("COVERING INDEX", StringComparison.Ordinal)
            || line.Contains("(album_id=?", StringComparison.Ordinal) || line.Contains("(ts>?)", StringComparison.Ordinal);
        var unbounded = plans.Where(p => !p.Value.All(Bounded)).Select(p => p.Key + " → " + string.Join("; ", p.Value)).ToList();
        Assert.True(unbounded.Count == 0, "reads every play's row:\n" + string.Join("\n", unbounded));
        // The ones Home, the album wall's Most played and the radio wait on, by name.
        string PlanOf(string start) => string.Join("; ", plans.First(p => p.Key.StartsWith(start, StringComparison.Ordinal)).Value);
        Assert.StartsWith("SEARCH plays USING INDEX plays_ts (ts>?)", PlanOf("SELECT album_id, MAX(ts) AS ts FROM plays WHERE ts >= $1"));
        Assert.Equal("SEARCH plays USING COVERING INDEX plays_album_ts (album_id>?)", PlanOf("SELECT DISTINCT album_id FROM plays WHERE ts >= $1"));
        Assert.Equal("SEARCH plays USING COVERING INDEX plays_album_ts (album_id>?)", PlanOf("SELECT album_id, COUNT(*) AS n, MAX(ts) AS t FROM plays"));
    }

    [Test]
    public async Task History_Not_played_and_Most_played_answer_as_before()
    {
        await using var s = await Session.Started();
        async Task<JsonNode> Get(string p) => (await s.Api(p)).J;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), day = 86_400_000;
        async Task<long> Id(string title) => (long)(await s.Album(title))!.Num("offset")!.Value;
        var (one, hi, best) = (await Id("Album One"), await Id("Hi Res"), await Id("Best Of"));
        void Play(long? album, long ts) => s.Server.InsertPlay(album, null, "Song", "Someone", "Something", "TEST", ts);
        Play(one, now - day);
        Play(one, now - 40 * day);
        Play(hi, now - 2 * 3_600_000);
        Play(null, now - 3_600_000);
        Play(best, now - 200 * day);
        static List<string?> Titles(JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title"))];

        // The last 30 days, the latest first, each album once; a play of no album left out.
        Assert.Equal(["Hi Res", "Album One"], Titles(await Get("home/history")));
        // Not heard in six months: Best Of alone, its play 200 days back.
        var u = await Get("home/unplayed?months=6&count=30");
        Assert.False(u.Bool("no_history"));
        Assert.Equal(["Best Of"], Titles(u));
        Assert.Equal(1.0, u.Num("total"));
        // Most played: Album One's two plays first; Last played: Hi Res.
        Assert.Equal("Album One", Titles(await Get("library/albums?sort=plays&dir=desc"))[0]);
        Assert.Equal("Hi Res", Titles(await Get("library/albums?sort=lastplayed&dir=desc"))[0]);
    }
}
