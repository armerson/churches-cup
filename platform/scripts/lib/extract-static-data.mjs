// Pulls the hard-coded tournament structure (groups, schedule, pitch
// assignments) out of the live churches-cup app's index.html. These
// const declarations are plain JS object/array literals — extracted as
// text and evaluated with `vm` in an empty sandbox (no access to
// anything else in that file, no network, no filesystem), not required
// or executed as part of the app itself.
//
// This covers the group stage fully: group membership, every group-stage
// kickoff time and pitch. It does NOT cover knockout team assignments or
// any actual match result — those are only known from the live
// Scores/KOMatches data on the deployed Apps Script backend (see
// fetch-live-data.mjs), since knockout pairings depend on live standings
// and aren't fixed in advance.

import { readFileSync } from "node:fs";
import vm from "node:vm";

const DECLARATIONS = [
  "groupSchedule",
  "groupPitch",
  "koSchedule",
  "groups",
  "pitches",
  "koPitchAssignment",
];

function extractDeclaration(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find "const ${name} = " in index.html — has the file structure changed?`);
  }
  const bodyStart = start + marker.length;
  // Each of these declarations is a `{...}` or `{...}` literal terminated
  // by `};` on its own — find the matching close brace by depth-counting
  // rather than assuming a fixed line count, so it's robust to the file
  // being edited around it.
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Could not find the closing brace for "const ${name}" — malformed object literal?`);
  }
  return source.slice(bodyStart, end);
}

export function extractStaticTournamentData(indexHtmlPath) {
  const source = readFileSync(indexHtmlPath, "utf8");
  const result = {};
  for (const name of DECLARATIONS) {
    const literalText = extractDeclaration(source, name);
    // vm.runInNewContext: no access to this module's scope, no require,
    // no fs/network — just evaluates a JS object literal in isolation.
    result[name] = vm.runInNewContext(`(${literalText})`, {}, { timeout: 1000 });
  }
  return result;
}
