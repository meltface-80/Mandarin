// LogLine.cs — a line of the server's log as the code writes it (bug list item 121). An interpolated
// string handed to Server.Log comes here: the whole line for the console, as before, and, while
// diagnostics are on (Diagnostics.cs), the line to keep for them: as written, but for an account's name
// or login (Personal, Diagnostics.Hole) and what LogScrub takes out of any line (item 235).
using System.Runtime.CompilerServices;

namespace Mandarin.Server;

[InterpolatedStringHandler]
internal ref struct LogLine
{
    private DefaultInterpolatedStringHandler full;
    private readonly System.Text.StringBuilder? kept;

    public LogLine(int literalLength, int formattedCount)
    {
        full = new DefaultInterpolatedStringHandler(literalLength, formattedCount, System.Globalization.CultureInfo.CurrentCulture);
        kept = Diagnostics.On ? new System.Text.StringBuilder(literalLength + 8 * formattedCount) : null;
    }

    public void AppendLiteral(string s) { full.AppendLiteral(s); kept?.Append(s); }
    public void AppendFormatted<T>(T value) { full.AppendFormatted(value); kept?.Append(Diagnostics.Hole(value)); }
    public void AppendFormatted<T>(T value, string? format) { full.AppendFormatted(value, format); kept?.Append(Diagnostics.Hole(value)); }
    public void AppendFormatted<T>(T value, int alignment) { full.AppendFormatted(value, alignment); kept?.Append(Diagnostics.Hole(value)); }
    public void AppendFormatted<T>(T value, int alignment, string? format) { full.AppendFormatted(value, alignment, format); kept?.Append(Diagnostics.Hole(value)); }
    public void AppendFormatted(string? value) { full.AppendFormatted(value); kept?.Append(Diagnostics.Hole(value)); }

    /* The whole line, for the console. */
    public string Text() => full.ToStringAndClear();
    /* The line kept for diagnostics, or null while they are off. */
    public readonly string? Kept() => kept == null ? null : LogScrub.Line(kept.ToString());
}
