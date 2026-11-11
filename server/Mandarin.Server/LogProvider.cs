// LogProvider.cs — what ASP.NET and Kestrel say themselves, into the server's log (logs, item 389). Their own logging
// was cleared (Program.cs) so the console held only Mandarin's lines, and with it went what they said when a request
// threw: an empty 500, and nothing anywhere to say why (the audit's I-M8). Their warnings and errors, with the
// exception and its stack, are now lines like any other, as [aspnet]; what is merely information is still left out.
// And an exception nothing caught, on any thread or in a task no one waited for, is a line before the process goes.
namespace Mandarin.Server;

internal sealed class LogProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Logger(categoryName);
    public void Dispose() { }

    private sealed class Logger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning && logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var level = logLevel >= LogLevel.Error ? "ERROR" : "WARN";
            var text = $"[aspnet] {Short(category)}: {formatter(state, exception)}" + (exception != null ? "\n" + exception : "");
            Server.Log(text, level);
        }

        /* "Microsoft.AspNetCore.Server.Kestrel" as "Kestrel": the last part of the category but one, for a type. */
        private static string Short(string c)
        {
            var parts = c.Split('.');
            return parts.Length > 1 ? parts[^2] + "." + parts[^1] : c;
        }
    }

    /* An exception nothing caught kept before the process ends, and one in a task no one waited for. */
    public static void CatchUnhandled()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Server.Log("[crash] an exception nothing caught; the server stops: " + e.ExceptionObject, "ERROR");
        TaskScheduler.UnobservedTaskException += (_, e) =>
            Server.Log("[crash] a task failed with no one waiting on it: " + e.Exception, "WARN");
    }
}
