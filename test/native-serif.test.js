"use strict";
/*
 * The page's titles are set in its display face, Young Serif (style.css: "Titles in the serif; the rest in Manrope"),
 * and the app's native screens draw the same titles in the same face (bug list item 77: the album editor's heading
 * was drawn in Manrope). Held in the source: each title the page sets in the serif (measured by
 * tools/quality/page-metrics.js), where the app draws it, is a Text in the serif.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const contract = require("../docs/specs/screens.json");

// The keys whose words the page sets in Young Serif, each on a Text of its own in the app.
const SERIF = ["home.greeting", "library.title", "album-edit.heading", "settings.heading", "settings-setup.heading", "settings-account.heading",
  "settings-keys.heading", "pitchfork.title", "service-browser.title"];

const APP_DIR = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const APP = fs.readdirSync(APP_DIR).filter(f => f.endsWith(".kt"));

/* The call [name]( that holds [at] in [src]: its text, from the name to its closing bracket. */
function callAround(src, at, name) {
  let i = src.lastIndexOf(name + "(", at);
  while (i >= 0) {
    let depth = 0, j = i + name.length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    if (j > at) return src.slice(i, j + 1);
    i = src.lastIndexOf(name + "(", i - 1);
  }
  return null;
}

test("every title the page sets in the serif, the app draws in the serif", () => {
  for (const key of SERIF) {
    const files = contract.screens[key.split(".")[0]].native || [];
    let found = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
      for (const m of src.matchAll(/parity\("([^"]+)"/g)) {
        if (!m[1].split(/\s+/).includes(key)) continue;
        // On a Text of its own, or handed to a helper of the screen's that draws its title (SettingsHead): that helper's Text.
        let call = callAround(src, m.index, "Text");
        const helper = [...src.slice(Math.max(0, m.index - 300), m.index).matchAll(/\b([A-Z]\w*)\(/g)].pop();
        if (!call && helper) {
          for (const other of APP) {
            const s2 = fs.readFileSync(path.join(APP_DIR, other), "utf8"), def = s2.indexOf("fun " + helper[1] + "(");
            if (def >= 0) { call = callAround(s2, s2.indexOf("Text(", def) + 1, "Text"); break; }
          }
        }
        if (!call) continue;
        found++;
        assert.match(call, /fontFamily = youngSerif/, key + " in " + path.basename(f) + " is drawn in the serif");
      }
    }
    assert.ok(found > 0, key + ": a Text carries it");
  }
});
