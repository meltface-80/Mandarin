namespace Mandarin.StandIns;

/// <summary>
/// One program for every stand-in the tests need: the first argument names the part, the second is the
/// path of the script it was started through (where the real program would be, so what it writes down
/// lands beside it), the rest are the arguments the server gave.
/// </summary>
public static class Program
{
    /// <summary>The part played to its end: its exit code.</summary>
    public static async Task<int> Main(string[] args)
    {
        if (args.Length < 2) { await Console.Error.WriteLineAsync("usage: Mandarin.StandIns <part> <script> [args…]"); return 2; }
        return args[0] switch
        {
            "musicdnet" => await Musicdnet.Run(args[1], args[2..]),
            _ => Unknown(args[0])
        };
    }

    private static int Unknown(string part) { Console.Error.WriteLine("no stand-in called " + part); return 2; }
}
