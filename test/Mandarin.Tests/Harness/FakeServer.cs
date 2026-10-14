using System.Net;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Mandarin.Tests;

/// <summary>
/// A test's own HTTP server (a stand-in service, a speaker, a player): Kestrel on a loopback address,
/// every request handed to the test's handler. Port 0 takes any free port (Base says which). Stopped
/// with its connections cut, so a server that keeps a connection to it never holds the test.
/// </summary>
public sealed class FakeServer : IAsyncDisposable
{
    private readonly WebApplication app;

    /// <summary>"http://host:port".</summary>
    public string Base { get; }

    /// <summary>The port it listens on.</summary>
    public int Port { get; }

    private FakeServer(WebApplication app, string host, int port, string scheme) { this.app = app; Port = port; Base = $"{scheme}://{host}:{port}"; }

    /// <summary>
    /// Started on <paramref name="host"/>:<paramref name="port"/> (0: any), answering with <paramref name="handle"/>;
    /// over HTTPS with <paramref name="cert"/> when one is given ("https://host:port").
    /// </summary>
    public static async Task<FakeServer> Start(Func<HttpContext, Task> handle, string host = "127.0.0.1", int port = 0, X509Certificate2? cert = null)
    {
        var b = WebApplication.CreateSlimBuilder();
        b.Logging.ClearProviders();
        b.WebHost.ConfigureKestrel(k =>
        {
            k.Listen(IPAddress.Parse(host), port, l => { if (cert != null) l.UseHttps(cert); });
            k.AllowSynchronousIO = true;
            k.Limits.MaxRequestBodySize = null;
        });
        b.Services.Configure<KestrelServerOptions>(o => o.AddServerHeader = false);
        var app = b.Build();
        app.Run(ctx => handle(ctx));
        await app.StartAsync();
        var addr = app.Urls.First();
        var bound = new Uri(addr.Replace("[::]", host, StringComparison.Ordinal)).Port;
        return new FakeServer(app, host, bound, cert != null ? "https" : "http");
    }

    /// <summary>Stopped, its connections cut at once.</summary>
    public async ValueTask DisposeAsync()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        try { await app.StopAsync(cts.Token); } catch (OperationCanceledException) { }
        await app.DisposeAsync();
    }
}
