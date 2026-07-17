import assert from "node:assert/strict";
import test from "node:test";

import { buildFongmiCompactSeasonKeywords } from "./fongmi-source-preference.js";
import { titleMatches } from "../../utils/common-util.js";

test("FongMi should add an explicit season keyword for compact sequel titles", () => {
  const keywords = ["现在就出发2", ...buildFongmiCompactSeasonKeywords(["现在就出发2"])];

  assert.deepEqual(keywords, ["现在就出发2", "现在就出发第2季"]);
  assert.equal(titleMatches("现在就出发 第2季", keywords[1]), true);
});

test("FongMi compact season keywords should preserve numeric title boundaries", () => {
  const keywords = buildFongmiCompactSeasonKeywords(["乡村爱情18"]);

  assert(keywords.includes("乡村爱情第18季"));
  assert.equal(titleMatches("乡村爱情8（上）", "乡村爱情第18季"), false);
});

test("FongMi should not treat a trailing year as a season", () => {
  assert.deepEqual(buildFongmiCompactSeasonKeywords(["奔跑吧2024", "奔跑吧"]), []);
});
