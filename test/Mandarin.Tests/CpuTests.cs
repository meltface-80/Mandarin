using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The processor shared out, playback first (v0.8.13): which cores playback keeps (one, two while DSP
/// is in use) from the machine and PLAYBACK_CORES / PLAYBACK_CORE, and each kind of work started where
/// it belongs. The C# server's rule (Cpu.cs, Cpu.Place.cs), asked through `mandarin-server score`; the
/// program kept to it for real in CpuAloneTests (test/cpu.test.js, in C#).
/// </summary>
public sealed class CpuTests
{
    private static async Task<JsonNode> Decide(JsonObject o) => (await Score.Run(new JsonObject { ["fn"] = "cpu", ["decides"] = new JsonArray(o) }))["decides"]![0]!;

    private static async Task<JsonNode> Wrap(string bin, string[] args, string kind, JsonObject o)
    {
        var place = (JsonObject)o.DeepClone();
        place["bin"] = bin; place["args"] = new JsonArray([.. args.Select(a => (JsonNode)a)]); place["kind"] = kind;
        return (await Score.Run(new JsonObject { ["fn"] = "cpu", ["places"] = new JsonArray(place) }))["places"]![0]!;
    }

    private static JsonArray N(int k) => new([.. Enumerable.Range(0, k).Select(i => (JsonNode)i)]);

    // [split, playback, background, core] for a machine.
    private static async Task<string> D(JsonArray cores, bool dsp = false, Dictionary<string, string>? env = null, bool notLinux = false, bool taskset = true)
    {
        var o = new JsonObject { ["linux"] = !notLinux, ["taskset"] = taskset, ["env"] = JsonNode.Parse(Http.Json(env ?? [])), ["cores"] = cores };
        if (dsp) o["dsp"] = true;
        var r = await Decide(o);
        return new JsonArray(r["split"]?.DeepClone(), r["playback"]?.DeepClone(), r["background"]?.DeepClone(), r["core"]?.DeepClone()).ToJsonString();
    }

    [Test]
    public async Task Playbacks_cores_the_last_one_two_with_DSP_at_least_two_left_on_four_or_more_chosen_or_turned_off()
    {
        JsonAssert.Same("[true,[3],[0,1,2],3]", JsonNode.Parse(await D(N(4))), "four cores: one for playback, three for the rest");
        JsonAssert.Same("[true,[2,3],[0,1],3]", JsonNode.Parse(await D(N(4), dsp: true)), "with DSP: two and two");
        JsonAssert.Same("[true,[7],[0,1,2,3,4,5,6],7]", JsonNode.Parse(await D(N(8))));
        JsonAssert.Same("[true,[6,7],[0,1,2,3,4,5],7]", JsonNode.Parse(await D(N(8), dsp: true)));
        JsonAssert.Same("[true,[2],[0,1],2]", JsonNode.Parse(await D(N(3))));
        JsonAssert.Same("[true,[1,2],[0],2]", JsonNode.Parse(await D(N(3), dsp: true)));
        JsonAssert.Same("[false,[],[0,1],null]", JsonNode.Parse(await D(N(2))), "two cores: shared");
        JsonAssert.Same("[true,[1],[0],1]", JsonNode.Parse(await D(N(2), env: new() { ["PLAYBACK_CORE"] = "1" })), "asked for: even on two");
        JsonAssert.Same("[true,[2],[0,1,3,4,5,6,7],2]", JsonNode.Parse(await D(N(8), env: new() { ["PLAYBACK_CORE"] = "2" })), "a core chosen");
        JsonAssert.Same("[true,[2,7],[0,1,3,4,5,6],2]", JsonNode.Parse(await D(N(8), dsp: true, env: new() { ["PLAYBACK_CORE"] = "2" })), "and DSP's second from the end");
        JsonAssert.Same("[true,[7],[0,1,2,3,4,5,6],7]", JsonNode.Parse(await D(N(8), env: new() { ["PLAYBACK_CORE"] = "99" })), "a core the machine hasn't: the last");
        Assert.True(JsonNode.Parse(await D(N(8), env: new() { ["PLAYBACK_CORE"] = "0" }))![0]!.GetValue<bool>() == false, "PLAYBACK_CORE=0 turns it off (v0.7.7)");
        Assert.True(JsonNode.Parse(await D(N(8), env: new() { ["PLAYBACK_CORES"] = "0" }))![0]!.GetValue<bool>() == false, "PLAYBACK_CORES=0 turns it off");
        JsonAssert.Same("[true,[2,3],[0,1],3]", JsonNode.Parse(await D(N(4), env: new() { ["PLAYBACK_CORES"] = "2" })), "two always");
        JsonAssert.Same("[true,[3],[0,1,2],3]", JsonNode.Parse(await D(N(4), dsp: true, env: new() { ["PLAYBACK_CORES"] = "1" })), "one always, DSP or not");
        JsonAssert.Same("[true,[1,2,3],[0],3]", JsonNode.Parse(await D(N(4), env: new() { ["PLAYBACK_CORES"] = "9" })), "never every core");
        JsonAssert.Same("[true,[7],[4,5,6],7]", JsonNode.Parse(await D(new JsonArray(4, 5, 6, 7))), "a container's own cores");
        Assert.True(JsonNode.Parse(await D(N(8), notLinux: true))![0]!.GetValue<bool>() == false, "off Linux: no taskset, shared");
        Assert.True(JsonNode.Parse(await D(N(8), taskset: false))![0]!.GetValue<bool>() == false, "no taskset: shared");
        var r = await Score.Run(new { fn = "cpu", expands = new[] { "0-2,5" }, compacts = new[] { new[] { 5, 0, 2, 1 } } });
        JsonAssert.Same("[0,1,2,5]", r["expands"]![0]);
        Assert.Equal("0-2,5", (string?)r["compacts"]![0]);
    }

    [Test]
    public async Task Each_kind_started_where_it_belongs_below_what_it_should_yield_to()
    {
        // A Linux machine's plan (taskset, ionice), only decided, nothing run.
        JsonObject Four() => new() { ["tools"] = new JsonObject { ["taskset"] = true, ["nice"] = true, ["ionice"] = true }, ["cores"] = N(4), ["env"] = new JsonObject() };
        async Task<JsonNode> W(string kind, JsonObject? o = null, string bin = "ffmpeg", string[]? args = null) => await Wrap(bin, args ?? ["-i", "x"], kind, o ?? Four());
        JsonAssert.Same("[3]", (await Decide(Four()))["playback"]);
        JsonAssert.Same("""["taskset","-c","3","ffmpeg","-i","x"]""", await W("realtime"));
        JsonAssert.Same("""["taskset","-c","3","ffmpeg","-i","x"]""", await W("playback"));
        JsonAssert.Same("""["nice","-n","5","taskset","-c","3","ffmpeg","-i","x"]""", await W("ahead"));
        JsonAssert.Same("""["nice","-n","19","ionice","-c","2","-n","7","taskset","-c","0-2","ffmpeg","-i","x"]""", await W("background"));
        Assert.Equal(3, (await Decide(Four()))["core"]!.GetValue<int>());
        Assert.Equal(3, (await Decide(Four()))["slots"]!.GetValue<int>());
        // Allowed to raise: the engine starts higher.
        var raise = Four(); raise["raise"] = true;
        JsonAssert.Same("""["nice","-n","-10","taskset","-c","3","e"]""", await W("realtime", raise, "e", []));
        // Nothing split (two cores): the priorities alone.
        JsonObject Two() => new() { ["tools"] = new JsonObject { ["taskset"] = true, ["nice"] = true, ["ionice"] = true }, ["cores"] = N(2), ["env"] = new JsonObject() };
        JsonAssert.Same("""["ffmpeg","-i","x"]""", await W("playback", Two()));
        JsonAssert.Same("""["nice","-n","19","ionice","-c","2","-n","7","ffmpeg","-i","x"]""", await W("background", Two()));
        Assert.Null((await Decide(Two()))["core"]);
        Assert.Equal(2, (await Decide(Two()))["slots"]!.GetValue<int>());
        // No tools at all: as it is.
        var none = Four(); none["tools"] = new JsonObject { ["taskset"] = false, ["nice"] = false, ["ionice"] = false };
        JsonAssert.Same("""["ffmpeg","-i","x"]""", await W("background", none));
    }
}
