using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>The plan behind the queue's Play now / Play next on a selection (v0.6.24; Playback/QueueMoves.cs; test/queue-moves.test.js, in C#).</summary>
public sealed class QueueMovesTests
{
    private static async Task<JsonNode> PlanMoves(int length, int current, int[] positions) =>
        (await Score.Run(new { fn = "moves", plans = new[] { new { length, current, positions } } }))["plans"]![0]!;

    private static int[] Ints(JsonNode? n) => [.. n.Items().Select(x => x!.GetValue<int>())];

    [Test]
    public async Task Picks_land_after_the_track_playing_in_the_order_picked()
    {
        var p = await PlanMoves(6, 2, [5, 4]);
        Assert.Equal([1, 2, 5, 4, 3, 6], Ints(p["order"]));
        JsonAssert.Same("""[{"from":5,"insertBefore":3,"at":3},{"from":5,"insertBefore":4,"at":4}]""", p["moves"]);
        Assert.Equal(3, p["first"]!.GetValue<int>());
    }

    [Test]
    public async Task A_pick_from_before_the_track_playing_moves_the_track_playing_up_one()
    {
        var p = await PlanMoves(6, 3, [1]);
        Assert.Equal([2, 3, 1, 4, 5, 6], Ints(p["order"]));
        Assert.Equal(2, p["current"]!.GetValue<int>());
        Assert.Equal(3, p["first"]!.GetValue<int>());
    }

    [Test]
    public async Task Nothing_playing_picks_go_to_the_top_the_one_playing_and_one_already_next_stay()
    {
        var top = Ints((await PlanMoves(6, 0, [6, 2]))["order"]);
        Assert.Equal([6, 2, 1, 3, 4, 5], top);
        var p = await PlanMoves(6, 2, [3, 2]);
        Assert.Empty(p["moves"].Items());
        Assert.Equal([1, 2, 3, 4, 5, 6], Ints(p["order"]));
        Assert.True(!(await PlanMoves(3, 1, [9]))["moves"].Items().Any(), "a position that isn't there is ignored");
    }
}
