using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// A player that closes its connection once it has answered (Audirvana's UPnP renderer does): the next
/// control request, sent on the pooled connection, must not fail; it is sent once more on a fresh one
/// (v0.7.1). The C# server's sender (Playback/SoapHttp.cs, through `mandarin-server score`;
/// test/soap-retry.test.js, in C#).
/// </summary>
public sealed class SoapRetryTests
{
    private const string Type = "urn:schemas-upnp-org:service:AVTransport:1";
    private static string Answer(string action) => $"""<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:{action}Response xmlns:u="{Type}"></u:{action}Response></s:Body></s:Envelope>""";

    /* The calls made one after another, each [wait] ms after the last: each { out } or { error }. */
    private static async Task<List<JsonNode?>> Calls(string url, int[] waits) =>
        [.. (await Score.Run(new { fn = "soapcall", calls = waits.Select(wait => new { url, service = Type, action = "Stop", args = new { InstanceID = 0 }, wait }).ToArray() }))["results"].Items()];

    [Test]
    public async Task A_control_request_on_a_connection_the_player_has_closed_is_sent_again_on_a_new_one()
    {
        int requests = 0, dropped = 0;
        var perConnection = new ConcurrentDictionary<string, int>();
        await using var srv = await FakeServer.Start(async ctx =>
        {
            Interlocked.Increment(ref requests);
            // A second request on the same connection is dropped without an answer: the player promised keep-alive and did not mean it.
            if (perConnection.AddOrUpdate(ctx.Connection.Id, 1, (_, n) => n + 1) > 1) { Interlocked.Increment(ref dropped); ctx.Abort(); return; }
            await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            ctx.Response.Headers.Connection = "keep-alive";
            ctx.Response.ContentType = "text/xml";
            await ctx.Response.WriteAsync(Answer("Stop"));
        });
        var url = srv.Base + "/AVTransport/control";
        // The second and third on the dead pooled socket first, the player having cut it by then.
        var results = await Calls(url, [0, 80, 80]);
        Assert.True(results.All(x => x?["error"] == null), new JsonArray([.. results.Select(x => x?.DeepClone())]).ToJsonString());
        Assert.True(dropped >= 1, "the pooled connection was dropped under a request: " + dropped);
        Assert.True(requests >= 3 + dropped, "and each dropped one was sent again: " + requests);
    }

    [Test]
    public async Task A_request_that_fails_on_a_fresh_connection_is_a_real_failure()
    {
        await using var srv = await FakeServer.Start(ctx => { ctx.Abort(); return Task.CompletedTask; });
        Assert.Matches("not responding", (await Calls(srv.Base + "/AVTransport/control", [0]))[0].Str("error"));
    }
}
