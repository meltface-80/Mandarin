// @ts-check
/*
 * shelforder.js — the Shelf's two orders (v1.0.1): A → Z by artist, as the
 * server sends the library (the Library wall's artist order), and A → Z by
 * album, made here from the same list. The page switches between them with
 * the order's name above the shelf; each device keeps its own.
 *
 * By album, titles are read as the server reads them for the Library wall's
 * Album order (Names.SortName): a leading "The", "A" or "An" (or one put last,
 * "Wall, The") doesn't count, and case, accents and punctuation are folded
 * away. Compared as the server compares names, a title that is only signs
 * comes first, then those starting with a number, then the letters — as the
 * artist order has them. One title twice: the artist's order between them.
 */
(function shelfOrder() {
  "use strict";
  const collator = new Intl.Collator("en", { sensitivity: "variant" });

  /**
   * A name folded as the server folds it (Names.Fold): accents and case gone,
   * "&" as "and", anything but letters and numbers a single space.
   * @param {string} s
   * @returns {string}
   */
  function fold(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  /**
   * The name a title is filed under (Names.SortName): "The Wall" and "Wall, The" under "wall".
   * @param {string} title
   * @returns {string}
   */
  function titleKey(title) {
    const t = String(title || "").trim();
    const last = /^(.*),\s*(the|a|an)$/i.exec(t);
    return fold(last ? last[1] : t.replace(/^(the|a|an)\s+/i, ""));
  }

  /**
   * The letter a title is filed under, as the server files an artist (ShelfBucket): A–Z, 1–9 or "#".
   * @param {string} key a folded name
   * @returns {string}
   */
  function bucket(key) {
    const c = key.charAt(0);
    if (c >= "a" && c <= "z") return c.toUpperCase();
    if (c >= "1" && c <= "9") return c;
    return "#";
  }

  /**
   * The albums by title, A → Z: a new list of the same albums, each given the
   * letter its title is filed under (`tb`, for the spines' tabs). The list
   * given, in artist order, keeps its order.
   * @template {{ t: string, tb?: string }} A
   * @param {A[]} albums
   * @returns {A[]}
   */
  function byAlbum(albums) {
    const keyed = albums.map((a, i) => ({ a, i, k: titleKey(a.t) }));
    keyed.sort((x, y) => collator.compare(x.k, y.k) || x.i - y.i);
    return keyed.map(({ a, k }) => { a.tb = bucket(k); return a; });
  }

  /** @type {any} */ (window).ShelfOrder = { fold, titleKey, bucket, byAlbum };
})();
