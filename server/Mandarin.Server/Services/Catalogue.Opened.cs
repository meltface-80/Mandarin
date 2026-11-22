// Catalogue.Opened.cs — what a service still owes of an album of the library, fetched when its page is opened (bug list
// item 519: Spotify's import takes the saved list alone, an album's missing tracks fetched once, here). Nothing owed by
// the other services: their imports read each album whole.
namespace Mandarin.Server.Services;

internal abstract partial class Catalogue
{
    /// <summary>An album of the library opened (its page): what the service still owes of it fetched now.</summary>
    public virtual Task Opened(string id) => Task.CompletedTask;
}
