// @ts-check
"use strict";
/*
 * ESLint (docs/quality-plan.md): the recommended rules over the server, the
 * tools, the tests and the pages, run from the repository root (npm run lint).
 * What they found on the day the gate came is recorded in
 * tools/lint/eslint-suppressions.json (ESLint's own suppressions file) and may
 * only go down: a new finding anywhere fails, and a suppressed one that is
 * fixed fails too until `npm run lint:prune` takes it out. Rules are added
 * here as the suppressions empty, never loosened.
 */
const js = require("@eslint/js");
const globals = require("globals");

const node = {
  files: ["index.js", "launcher.js", "reset-password.js", "lib/**/*.js", "tools/**/*.js", "test/**/*.js"],
  languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: { ...globals.node, ...globals.es2024 } }
};
// The page's scripts share one window: what one defines for the others (sharecard.js, srp.js,
// the Android app's bridge) is a global to the rest.
const pages = {
  files: ["public/**/*.js"],
  languageOptions: {
    ecmaVersion: 2024, sourceType: "script",
    globals: { ...globals.browser, ...globals.es2024, ShareCard: "readonly", MusicdSrp: "readonly", MusicdDownloads: "readonly" }
  }
};
// Page scripts the Node tests load too: they look for module/require/Buffer before using them.
const shared = {
  files: ["public/biquad.js", "public/sharecard.js", "public/srp.js"],
  languageOptions: { globals: { module: "readonly", require: "readonly", Buffer: "readonly" } }
};
const rules = {
  rules: {
    // An argument or a caught error left unused is the code's style here (catch (e) { /* why */ }).
    "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-constant-condition": ["error", { checkLoops: false }],
    // Names, tags and headers are stripped of control characters on purpose (\x00-\x1f in a pattern).
    "no-control-regex": "off",
    // The page's scripts share one window; each declares its own name on it on purpose.
    "no-redeclare": ["error", { builtinGlobals: false }]
  }
};

module.exports = [
  { ignores: ["node_modules/**", "**/bin/**", "**/obj/**", "android/**", "dist/**", "docs/**", "data/**", "https:/**"] },
  js.configs.recommended,
  node,
  pages,
  shared,
  rules
];
