using System.Formats.Tar;
using System.Globalization;
using System.IO.Compression;

namespace Mandarin.Tests;

/// <summary>
/// Files for checking the C# tag reader (TagsFrontTests): every format the scanner reads, as ffmpeg made
/// them (kept, test/golden/tags-front.files.tar.gz), and the tag layouts ffmpeg doesn't write built here
/// byte by byte (ID3v2.2, 2.3 and 2.4 frames of every kind the reader knows, APEv2, Lyrics3, Vorbis
/// comments, DSF, DSDIFF, Monkey's Audio), then each copied damaged a few ways (test/tagfixtures.js, in C#: the same files, byte for byte).
/// </summary>
public static partial class TagFixtures
{
    private static string Kept => Path.Combine(ServerProcess.Root, "test", "golden", "tags-front.files.tar.gz");

    /// <summary>Makes the files in <paramref name="dir"/>; returns their paths.</summary>
    public static List<string> Build(string dir, int damage = 8)
    {
        Directory.CreateDirectory(dir);
        string P(string n) => Path.Combine(dir, n);
        var made = new List<string>();
        void Add(string n, bool ok = true) { if (ok && File.Exists(P(n))) made.Add(P(n)); }
        void Write(string n, byte[] buf) { File.WriteAllBytes(P(n), buf); Add(n); }

        // ffmpeg's own, as ffmpeg 6.1.1 made them when music-metadata's readings were kept: another ffmpeg
        // encodes and stamps them otherwise, and its files are no longer the ones those readings are of.
        // In the order they were made, which the damage below and the kept readings follow.
        using (var z = new GZipStream(File.OpenRead(Kept), CompressionMode.Decompress))
        using (var tar = new TarReader(z))
            while (tar.GetNextEntry() is { } e)
            {
                e.ExtractToFile(P(e.Name), true);
                if (!e.Name.StartsWith('_')) Add(e.Name);
            }

        // Built here.
        if (File.Exists(P("_bare.mp3")))
        {
            var mp3 = File.ReadAllBytes(P("_bare.mp3"));
            Write("rich_v23.mp3", Cat(Tag(3, Rich23()), mp3));
            Write("rich_v24.mp3", Cat(Tag(4, Rich24()), mp3));
            Write("v22.mp3", Cat(Tag(2, [F22("TT2", Txt(0, "Two Two")), F22("TP1", Txt(0, "AC/DC")), F22("TAL", Txt(1, "Alb")), F22("TRK", Txt(0, "3/9")),
                F22("TCO", Txt(0, "(13)")), F22("TYE", Txt(0, "1995")), F22("COM", Cat(U8(0), Latin1("engdesc\0comment text"))), F22("TXX", Txt(0, "BARCODE\0" + "123"))], padding: 64), mp3));
            Write("v23_ext.mp3", Cat(Tag(3, [F23("TIT2", Txt(0, "Ext Title")), F23("TCON", Txt(0, "Duo Cello/Piano"))], flags: 0x40, ext: Cat(Be32(6), U8(0, 0), Be32(0))), mp3));
            Write("v24_ext.mp3", Cat(Tag(4, [F24("TIT2", Txt(0, "Ext 24"))], flags: 0x40, ext: Cat(Be32(6), U8(1, 0))), mp3));
            Write("two_tags.mp3", Cat(Tag(3, [F23("TIT2", Txt(0, "First"))]), Tag(4, [F24("TPE1", Txt(0, "Second"))]), mp3));
            Write("v25.mp3", Cat(Tag(5, [F24("TIT2", Txt(0, "x"))]), mp3));
            Write("toolarge.mp3", Cat(Latin1("ID3"), U8(3, 0, 0), Syncsafe(10_000_000), F23("TIT2", Txt(0, "x"))));
            Write("utf16_odd.mp3", Cat(Tag(3, [F23("TIT2", U8(1, 0xff, 0xfe, 0x41, 0, 0x42)), F23("TPE1", U8(1, 0xfe, 0xff, 0, 0x41, 0)), F23("TALB", U8(2, 0, 0x41, 0))]), mp3));
            string[] genres = ["17", "(17)", "(17)(26)Rock", "Duo Cello/Piano", "((Escaped)", "(RX)(CR)", "Rock (live", "255", "(999)"];
            for (int i = 0; i < genres.Length; i++)
                Write($"genre{i}.mp3", Cat(Tag(3, [F23("TIT2", Txt(0, "G" + i)), F23("TCON", Txt(0, genres[i]))]), mp3));
            Write("ape_on.mp3", Cat(Tag(3, [F23("TIT2", Txt(0, "ID3 Title"))]), mp3,
                Ape([Item("Title", "APE Title"), Item("Artist", "APE Artist"), Item("Year", "1999-02-03"), Item("Track", "7"), Item("REPLAYGAIN_TRACK_GAIN", "+1.50 dB"),
                    Item("Genre", "Electronic\0Ambient"), Item("MUSICBRAINZ_ALBUMID", "ape-mbid"), ("Cover Art (Front)", Latin1("x.jpg\0\xff\xd8"), 2)]), Id3v1()));
            var lyr = Latin1("LYRICSBEGININD0000211LYR00005hello");
            Write("lyrics3.mp3", Cat(mp3, lyr, Latin1(lyr.Length.ToString(CultureInfo.InvariantCulture).PadLeft(6, '0') + "LYRICS200"), Id3v1()));
            Write("id3v1.mp3", Cat(mp3, Id3v1("Only V1", 0)));
        }
        if (File.Exists(P("plain.flac")))
        {
            Write("vorbis_rich.flac", FlacWithComments(P("plain.flac"), ["TITLE=Vorbis Title", "ARTIST=First Artist", "ARTIST=Second Artist",
                "ARTISTS=First Artist", "ALBUMARTIST=Album Artist", "ALBUM=Vorbis Album", "DATE=2011-04-02", "ORIGINALDATE=1977-02-04", "TRACKNUMBER=5",
                "TRACKTOTAL=11", "DISCNUMBER=1", "DISCTOTAL=2", "GENRE=Rock", "GENRE=rock", "GENRE=Pop; Jazz", "COMPILATION=1", "LABEL=Vorbis Label",
                "CATALOGNUMBER=CAT-001", "BARCODE=0039841500523", "ISRC=GBAYE0601690", "ISRC=GBAYE0601690", "MUSICBRAINZ_ALBUMID=f-mbid",
                "REPLAYGAIN_TRACK_GAIN=-3.20 dB", "REPLAYGAIN_TRACK_PEAK=0.95", "REPLAYGAIN_ALBUM_GAIN=-3.5 dB", "RELEASECOUNTRY=XE",
                "ALBUMARTISTSORT=Artist, Album", "RATING:user@example.com=0.8", "RATING=80", "UPC=123456789012", "1=numeric key", "ünïcode=key",
                "EMPTY=", "noequals", "COMMENT=  spaced  ", "METADATA_BLOCK_PICTURE=AAAA"], FlacPicture()));
            Write("id3_on.flac", Cat(Tag(3, [F23("TIT2", Txt(0, "ID3 on FLAC")), F23("TPE1", Txt(0, "ID3 Artist"))]), File.ReadAllBytes(P("plain.flac"))));
        }
        Write("plain.dsf", Dsf(true)); Write("notag.dsf", Dsf(false)); Write("dsd128.dsf", Dsf(true, 5644800));
        Write("plain.dff", Dff(true)); Write("notag.dff", Dff(false));
        Write("monkey.ape", Monkeys(true)); Write("notag.ape", Monkeys(false));

        // Names that send the reader to the file's first bytes instead.
        foreach (var (from, to) in new[] { ("plain.flac", "renamed.fla"), ("alac.m4a", "renamed.alac"), ("plain.aif", "renamed.aiff"), ("plain.aif", "renamed.aifc"), ("plain.wav", "renamed.wave"), ("id3_on.flac", "id3_renamed.fla") })
            if (File.Exists(P(from))) { File.Copy(P(from), P(to), true); Add(to); }
        File.Delete(P("_bare.mp3"));

        // Each damaged a few ways: cut short, and bytes changed near the start (the same on every run).
        var rnd = JsGen.Rng(20261008);
        foreach (var f in made.ToList())
        {
            var data = File.ReadAllBytes(f);
            string ext = Path.GetExtension(f), stem = Path.GetFileNameWithoutExtension(f);
            for (int i = 0; i < damage; i++)
            {
                var b = (byte[])data.Clone();
                if (i % 2 == 0) b = b[..Math.Max(1, JsGen.Floor(rnd() * Math.Min(b.Length, 8192 * (i + 1))))];
                else
                    for (int k = 0; k < 1 + JsGen.Floor(rnd() * 6); k++)
                    {
                        int pos = JsGen.Floor(rnd() * Math.Min(b.Length, 4096));
                        b[pos] = rnd() < 0.3 ? (byte)0 : rnd() < 0.5 ? (byte)0xff : (byte)JsGen.Floor(rnd() * 256);
                    }
                Write($"{stem}.d{i}{ext}", b);
            }
        }
        return made;
    }
}
