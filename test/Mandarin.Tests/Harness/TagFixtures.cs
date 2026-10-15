using System.Diagnostics;
using System.Globalization;

namespace Mandarin.Tests;

/// <summary>
/// Files for checking the C# tag reader (TagsFrontTests): every format the scanner reads, made with
/// ffmpeg, and the tag layouts ffmpeg doesn't write built here byte by byte (ID3v2.2, 2.3 and 2.4 frames
/// of every kind the reader knows, APEv2, Lyrics3, Vorbis comments, DSF, DSDIFF, Monkey's Audio), then
/// each copied damaged a few ways (test/tagfixtures.js, in C#: the same files, byte for byte).
/// </summary>
public static partial class TagFixtures
{
    private static readonly (string, string)[] Meta =
    [
        ("title", "Song Title"), ("artist", "The Artist"), ("album", "The Album"), ("album_artist", "Various Artists"), ("date", "2019-05-03"),
        ("track", "3/12"), ("disc", "1/2"), ("genre", "Rock;Pop"), ("comment", "A comment"), ("publisher", "Label Records")
    ];

    private static bool Ff(string output, string[] args, int seconds = 2, int rate = 44100, int ch = 2, (string, string)[]? tags = null, bool noTags = false)
    {
        var all = new List<string> { "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
            FormattableString.Invariant($"sine=frequency=440:duration={seconds}:sample_rate={rate}"), "-ac", ch.ToString(CultureInfo.InvariantCulture) };
        all.AddRange(args);
        foreach (var (k, v) in noTags ? Array.Empty<(string, string)>() : (tags ?? Meta)) all.AddRange(["-metadata", $"{k}={v}"]);
        all.Add(output);
        return Fixtures.Run(all).Code == 0;
    }

    private static readonly Lazy<string> Encoders = new(() => { var r = Fixtures.Run(["-hide_banner", "-encoders"]); return r.Code == 0 ? r.Out : ""; });

    /// <summary>Makes the files in <paramref name="dir"/>; returns their paths.</summary>
    public static List<string> Build(string dir, int damage = 8)
    {
        Directory.CreateDirectory(dir);
        string P(string n) => Path.Combine(dir, n);
        var made = new List<string>();
        void Add(string n, bool ok = true) { if (ok && File.Exists(P(n))) made.Add(P(n)); }
        void Write(string n, byte[] buf) { File.WriteAllBytes(P(n), buf); Add(n); }
        bool Has(string e) => Encoders.Value.Contains(" " + e + " ", StringComparison.Ordinal);

        // ffmpeg's own.
        if (Has("libmp3lame"))
        {
            Add("vbr_v24.mp3", Ff(P("vbr_v24.mp3"), ["-c:a", "libmp3lame", "-q:a", "2"], seconds: 5));
            Add("cbr_v23_v1.mp3", Ff(P("cbr_v23_v1.mp3"), ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", "-write_id3v1", "1"], seconds: 5));
            Add("cbr_noxing.mp3", Ff(P("cbr_noxing.mp3"), ["-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "0"], seconds: 5));
            Add("mpeg2_mono.mp3", Ff(P("mpeg2_mono.mp3"), ["-c:a", "libmp3lame", "-b:a", "32k"], seconds: 5, rate: 22050, ch: 1, noTags: true));
            Add("mpeg25.mp3", Ff(P("mpeg25.mp3"), ["-c:a", "libmp3lame", "-b:a", "16k"], seconds: 5, rate: 8000, ch: 1, noTags: true));
            Ff(P("_bare.mp3"), ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0"], seconds: 3, noTags: true);
        }
        if (Has("mp2")) Add("layer2.mp3", Ff(P("layer2.mp3"), ["-c:a", "mp2", "-b:a", "192k", "-f", "mp2"], seconds: 3));
        Add("plain.flac", Ff(P("plain.flac"), ["-c:a", "flac"]));
        Add("hires.flac", Ff(P("hires.flac"), ["-c:a", "flac", "-sample_fmt", "s32"], rate: 96000));
        Add("six.flac", Ff(P("six.flac"), ["-c:a", "flac"], ch: 6, rate: 48000, noTags: true));
        if (Has("libvorbis")) { Add("short.ogg", Ff(P("short.ogg"), ["-c:a", "libvorbis"])); Add("long.ogg", Ff(P("long.ogg"), ["-c:a", "libvorbis"], seconds: 30)); }
        if (Has("libopus"))
        {
            Add("short.opus", Ff(P("short.opus"), ["-c:a", "libopus", "-metadata", "R128_TRACK_GAIN=-1234", "-metadata", "R128_ALBUM_GAIN=512"]));
            Add("long.opus", Ff(P("long.opus"), ["-c:a", "libopus"], seconds: 30));
            // A comment header over several pages.
            Add("bigcomment.opus", Ff(P("bigcomment.opus"), ["-c:a", "libopus", "-metadata", "lyrics=" + string.Concat(Enumerable.Repeat("la ", 25000))]));
        }
        Add("flac_in.oga", Ff(P("flac_in.oga"), ["-c:a", "flac", "-f", "ogg"]));
        if (Has("libspeex")) Add("speex.ogg", Ff(P("speex.ogg"), ["-c:a", "libspeex", "-f", "ogg"], rate: 16000, ch: 1));
        Add("aac.m4a", Ff(P("aac.m4a"), ["-c:a", "aac", "-b:a", "128k", "-movflags", "+use_metadata_tags", "-metadata", "MusicBrainz Album Id=m4a-mbid", "-metadata", "BARCODE=5012345678900"]));
        Add("alac.m4a", Ff(P("alac.m4a"), ["-c:a", "alac"]));
        Add("alac_hires.m4a", Ff(P("alac_hires.m4a"), ["-c:a", "alac", "-sample_fmt", "s32p"], rate: 96000));
        Add("frag.m4a", Ff(P("frag.m4a"), ["-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov"]));
        Add("plain.wav", Ff(P("plain.wav"), ["-c:a", "pcm_s16le"]));
        Add("hires24.wav", Ff(P("hires24.wav"), ["-c:a", "pcm_s24le"], rate: 96000));
        Add("six.wav", Ff(P("six.wav"), ["-c:a", "pcm_s16le"], ch: 6, rate: 48000, noTags: true));
        Add("bext.wav", Ff(P("bext.wav"), ["-c:a", "pcm_s16le", "-write_bext", "1", "-metadata", "description=bext desc", "-metadata", "originator=me"], noTags: true));
        Add("plain.aif", Ff(P("plain.aif"), ["-c:a", "pcm_s16be", "-write_id3v2", "1"]));
        Add("hires.aif", Ff(P("hires.aif"), ["-c:a", "pcm_s24be"], rate: 96000, noTags: true));
        if (Has("wavpack")) { Add("plain.wv", Ff(P("plain.wv"), ["-c:a", "wavpack"])); Add("hires.wv", Ff(P("hires.wv"), ["-c:a", "wavpack", "-sample_fmt", "s32p"], rate: 96000)); }
        if (Has("wmav2")) Add("plain.wma", Ff(P("plain.wma"), ["-c:a", "wmav2", "-b:a", "128k"]));
        Add("plain.aac", Ff(P("plain.aac"), ["-c:a", "aac", "-f", "adts"]));

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
