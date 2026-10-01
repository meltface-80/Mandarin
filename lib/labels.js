"use strict";
/*
 * labels.js — what makes a record label's name, from the file tags (Stage 8).
 *
 * A label is named a dozen ways across a library: "Blue Note", "Blue Note
 * Records", "Blue Note Records (UK)", "BLUE NOTE". They are one label, so each
 * name folds to a key — the trailing company words and country qualifiers
 * dropped, then letters and digits only — and the albums gather under it. The
 * name shown is the plainest one the files carry.
 *
 * Some tags hold a name that is not a label at all (a management company, a
 * foundation); those are left out rather than shown as labels.
 */
const path = require("path");

const LABEL_SUFFIX_RE = /\s+(Records?|Recordings?|Music|Label|Labels|Group|Entertainment|Productions?|Publishing|Inc\.?|Ltd\.?|LLC|GmbH|S\.A\.?|s\.r\.l\.?|Verlag|Editions?|Edition)\.?\s*$/i;
const COUNTRY_REGION_SUFFIX_RE = /\s+(United\s+States|United\s+Kingdom|New\s+Zealand|South\s+Africa|Latin\s+America|North\s+America|Group\s+International|US|USA|UK|America|Canada|France|Germany|Belgium|Russia|Australia|Japan|Italy|Spain|Netherlands|Holland|Ireland|Sweden|Norway|Denmark|Finland|Poland|Brazil|Mexico|Argentina|Chile|China|Korea|India|Portugal|Switzerland|Austria|Romania|Greece|Hungary|Turkey|International|Classics?|Cooperative|Global|Worldwide|Latino|Nordic|Iberian|Benelux|Scandinavia|Asia|Europe|Africa|Pacific|APAC)\b\s*$/i;
const NON_LABEL_RE = /\b(management|agency|agencies|booking|touring|representation|ministry|foundation|fund)\b/i;
// A tag with nothing to say: "Unknown", "none", a bare year, "self-released".
const EMPTY_RE = /^(unknown|none|n\/a|null|-|\d{4}|self[\s-]?released|independent|various)$/i;

function trimPunct(s) { return s.replace(/[,;:]+$/, "").trim(); }
// A trailing bracketed qualifier, "(UK)" or "[Reissue]", when a name is left: "[PIAS]" is a name.
function stripBrackets(s) { return s.replace(/^(.*\S)\s*[([{][^()[\]{}]*[)\]}]\s*$/, "$1").trim(); }

/* The name with its company words and country dropped: "Blue Note". */
function canonicalLabelName(name) {
  if (!name) return "";
  let s = trimPunct(String(name).trim());
  for (let i = 0; i < 2; i++) {
    s = trimPunct(stripBrackets(s));
    s = trimPunct(s.replace(COUNTRY_REGION_SUFFIX_RE, ""));
    s = trimPunct(s.replace(LABEL_SUFFIX_RE, ""));
  }
  return s || String(name).trim();
}

/* What two spellings of one label share: the canonical name, lower case,
 * letters and digits only. */
function labelKey(name) {
  const s = canonicalLabelName(name);
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function isLikelyNotALabel(name) {
  const s = String(name || "").trim();
  return !s || NON_LABEL_RE.test(s) || EMPTY_RE.test(s);
}

/*
 * The label a library filed by label gives an album: the folder at [depth]
 * under the music folder the album is in. "/music/Jazz/Blue Note/Album" is
 * depth 2. The album's own folder never counts, so an album filed shallower
 * than the depth has no folder label.
 */
function labelFromFolder(dir, roots, depth) {
  if (!dir || !depth || depth < 1) return null;
  const d = path.resolve(String(dir));
  const root = (roots || []).map(r => path.resolve(String(r)))
    .filter(r => d === r || d.startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
  if (!root) return null;
  const parts = path.relative(root, d).split(path.sep).filter(Boolean);
  if (parts.length <= depth) return null;
  return parts[depth - 1] || null;
}

module.exports = { canonicalLabelName, labelKey, isLikelyNotALabel, labelFromFolder };
