using System.Globalization;
using System.Text;

namespace Mandarin.Server;

/// <summary>
/// Genres in English: an album bought from Qobuz in French is tagged in French ("Électronique",
/// "Musique de chambre", "Bandes originales de films"), and the owner's library is read in English. Each genre the
/// library's albums carry is said in English wherever it is shown (Library.cs makes the snapshot every screen reads),
/// so "Électronique" and "Electronic" are one genre; the files are never written. A genre this doesn't know is left
/// as it is. A genre asked for by its French name (a wall or a rule from before) finds the English one.
/// </summary>
public static class GenreNames
{
    // Qobuz's French names for its genres, and the other French a tag writes, folded (lower case, no accents) to the
    // English Qobuz itself gives them in English.
    private static readonly Dictionary<string, string> French = Build(
        // Pop, rock and the rest
        ("électronique", "Electronic"), ("musique électronique", "Electronic"), ("électro", "Electro"),
        ("alternatif et indé", "Alternative & Indie"), ("rock alternatif", "Alternative Rock"), ("indé", "Indie"), ("rock indé", "Indie Rock"),
        ("rock indépendant", "Indie Rock"), ("pop indé", "Indie Pop"), ("rock progressif", "Progressive Rock"), ("rock psychédélique", "Psychedelic Rock"),
        ("métal", "Metal"), ("rock français", "French Rock"), ("rap français", "French Rap"), ("hip-hop français", "French Hip-Hop"),
        ("variété", "Pop"), ("variété française", "French Pop"), ("variété francophone", "French Pop"), ("variété internationale", "International Pop"),
        ("chanson française", "French Chanson"), ("chanson", "Chanson"), ("musique folk", "Folk"), ("musique country", "Country"),
        ("expérimental", "Experimental"), ("musique expérimentale", "Experimental"), ("minimaliste", "Minimalist"), ("musique minimaliste", "Minimalist"),
        ("ambiance", "Ambient"), ("musique d'ambiance", "Ambient"), ("bien-être", "Wellness"), ("relaxation", "Relaxation"),
        ("musique de noël", "Christmas Music"), ("noël", "Christmas"),
        // Jazz
        ("jazz vocal", "Vocal Jazz"), ("jazz contemporain", "Contemporary Jazz"), ("jazz traditionnel", "Traditional Jazz"), ("jazz manouche", "Gypsy Jazz"),
        ("jazz latin", "Latin Jazz"), ("jazz fusion & jazz rock", "Jazz Fusion & Jazz Rock"), ("jazz fusion et jazz rock", "Jazz Fusion & Jazz Rock"),
        // The world
        ("musiques du monde", "World Music"), ("musique du monde", "World Music"), ("musique africaine", "African Music"), ("afrique", "Africa"),
        ("asie", "Asia"), ("moyen-orient", "Middle East"), ("amérique latine", "Latin America"), ("amérique du nord", "North America"),
        ("musiques latines", "Latin"), ("musique latine", "Latin"), ("musique latino-américaine", "Latin American Music"), ("brésil", "Brazil"),
        ("inde", "India"), ("japon", "Japan"), ("musique celtique", "Celtic"), ("celtique", "Celtic"), ("musique irlandaise", "Irish Music"),
        ("musique orientale", "Oriental Music"), ("musique traditionnelle", "Traditional Music"),
        // Classical
        ("classique", "Classical"), ("musique classique", "Classical"), ("musique de chambre", "Chamber Music"), ("musique symphonique", "Symphonic Music"),
        ("oeuvres orchestrales", "Orchestral Music"), ("musique orchestrale", "Orchestral Music"), ("symphonies", "Symphonies"), ("concertos", "Concertos"),
        ("opéra", "Opera"), ("opéras", "Opera"), ("art lyrique", "Opera"), ("opérette", "Operetta"), ("extraits d'opéra", "Opera Extracts"),
        ("musique vocale (profane et sacrée)", "Vocal Music (Secular and Sacred)"), ("musique vocale", "Vocal Music"), ("musique sacrée", "Sacred Music"),
        ("musique chorale", "Choral Music"), ("chorale", "Choral Music"), ("choeurs", "Choral Music"), ("oratorios", "Oratorios"),
        ("messes, passions, requiems", "Masses, Passions, Requiems"), ("cantates (sacrées)", "Cantatas (Sacred)"), ("cantates (profanes)", "Cantatas (Secular)"),
        ("cantates", "Cantatas"), ("mélodies", "Art Songs"), ("mélodies (france)", "Art Songs (France)"), ("lieder (allemagne)", "Lieder (Germany)"),
        ("musique baroque", "Baroque Music"), ("baroque", "Baroque"), ("musique ancienne", "Early Music"), ("musique médiévale", "Medieval Music"),
        ("musique de la renaissance", "Renaissance Music"), ("renaissance", "Renaissance"), ("musique contemporaine", "Contemporary Classical"),
        ("classique contemporain", "Contemporary Classical"), ("récitals instrumentaux", "Instrumental Recitals"), ("récitals vocaux", "Vocal Recitals"),
        ("récitals", "Recitals"), ("musique pour piano", "Solo Piano"), ("piano solo", "Solo Piano"), ("oeuvres pour piano", "Solo Piano"),
        ("musique pour orgue", "Organ Music"), ("oeuvres pour orgue", "Organ Music"), ("musique pour guitare", "Guitar Music"),
        ("duos", "Duets"), ("trios", "Trios"), ("quatuors", "Quartets"), ("quintettes", "Quintets"), ("ballets", "Ballets"), ("ouvertures", "Overtures"),
        ("musique de scène", "Incidental Music"), ("musique de ballet", "Ballet Music"), ("fanfares", "Brass Bands"), ("musique militaire", "Military Music"),
        // Film, stage and the rest
        ("bandes originales de films", "Film Soundtracks"), ("bande originale de film", "Film Soundtrack"), ("musique de film", "Film Music"),
        ("musique de films", "Film Music"), ("musiques de films", "Film Music"), ("bande originale", "Soundtrack"), ("bandes originales", "Soundtracks"),
        ("bande-son", "Soundtrack"), ("musique de jeux vidéo", "Video Game Music"), ("jeux vidéo", "Video Games"), ("séries tv", "TV Series"),
        ("séries télé", "TV Series"), ("comédies musicales", "Musicals"), ("comédie musicale", "Musical"), ("dessins animés", "Cartoons"),
        ("musique pour enfants", "Children's Music"), ("enfants", "Children's Music"), ("jeunesse", "Children's Music"), ("musique pour la jeunesse", "Children's Music"),
        ("humour", "Comedy"), ("spectacles", "Shows"), ("livres audio", "Audiobooks"), ("livre audio", "Audiobook"), ("littérature", "Spoken Word"),
        ("textes", "Spoken Word"), ("poésie", "Poetry"), ("musique concrète", "Musique Concrète"));

    private static Dictionary<string, string> Build(params (string Fr, string En)[] pairs)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (fr, en) in pairs) d[Key(fr)] = en;
        return d;
    }

    /// <summary>[genre] in English: Qobuz's English name for a French one, else [genre] as it is.</summary>
    public static string English(string genre) => French.TryGetValue(Key(genre), out var en) ? en : genre;

    /// <summary>No accents, "œ" as "oe", spaces as one (the dictionary ignores case): "Œuvres  orchestrales" and "oeuvres orchestrales" alike.</summary>
    private static string Key(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.Trim().Replace("œ", "oe", StringComparison.Ordinal).Replace("Œ", "Oe", StringComparison.Ordinal).Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsWhiteSpace(ch)) { if (sb.Length > 0 && sb[^1] != ' ') sb.Append(' '); continue; }
            sb.Append(ch);
        }
        return sb.ToString();
    }
}
