namespace Mandarin.StandIns;

/// <summary>
/// The private PulseAudio Soloist plays into (bug list item 142), as far as the server sees it: its socket made
/// (module-native-protocol-unix socket=…), and Spotify's sound written into the pipe sink's pipe (module-pipe-sink
/// file=…) as the real one writes what Soloist plays: S32 LE stereo at 44.1 kHz, here a 440 Hz tone of 24-bit
/// samples (the lowest byte zero), as Spotify's lossless 24-bit is carried. Until it is killed.
/// </summary>
public static class PulseAudio
{
    /// <summary>Played until killed, or the pipe's reader has gone.</summary>
    public static async Task<int> Run(string[] args)
    {
        string Option(string name) => args.SelectMany(a => a.Split(' ')).FirstOrDefault(w => w.StartsWith(name + "=", StringComparison.Ordinal))?[(name.Length + 1)..] ?? "";
        var socket = Option("socket");
        var fifo = Option("file");
        if (socket == "" || fifo == "") { await Console.Error.WriteLineAsync("E: no socket or pipe"); return 1; }
        await File.WriteAllTextAsync(socket, "");
        await using var pipe = new FileStream(fifo, FileMode.Open, FileAccess.Write, FileShare.ReadWrite, 0);
        const int Rate = 44100, Frames = 4410;
        var buf = new byte[Frames * 8];
        long n = 0;
        try
        {
            for (; ; )
            {
                for (int i = 0; i < Frames; i++, n++)
                {
                    int s24 = (int)Math.Round(Math.Sin(2 * Math.PI * 440 * n / Rate) * 0x3FFFFF);
                    int s32 = s24 << 8;
                    BitConverter.TryWriteBytes(buf.AsSpan(i * 8), s32);
                    BitConverter.TryWriteBytes(buf.AsSpan(i * 8 + 4), s32);
                }
                await pipe.WriteAsync(buf);
            }
        }
        catch (IOException) { return 0; }
    }
}
