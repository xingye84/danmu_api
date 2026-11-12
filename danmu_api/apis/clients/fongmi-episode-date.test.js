import assert from "node:assert/strict";
import test from "node:test";

import { Globals } from "../../configs/globals.js";
import { setSearchCache } from "../../utils/cache-util.js";
import { extractFongmiEpisodeDate, selectFongmiCandidateByAi } from "./fongmi-ai-match.js";
import { getFongmiDanmaku, scoreFongmiEpisodeMatch } from "./fongmi-api.js";

const NAME = "王牌对王牌第四季";
const RAW = "[1.30GB] 03.15期.mp4";
const ANIME = {
  animeId: 9300065,
  bangumiId: "879edcde15814c08b648",
  animeTitle: "王牌对王牌 第四季(2019)【综艺】from youku",
  source: "youku"
};

function reset(preference = false) {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.sourceOrderArr = ["youku"];
  globals.enableAnimeEpisodeFilter = false;
  globals.lastSelectMap.clear();
  if (preference) {
    globals.lastSelectMap.set(NAME, {
      animeIds: [ANIME.animeId],
      preferBySeason: { default: ANIME.animeId },
      sourceBySeason: { default: ANIME.source },
      explicitBySeason: { default: preference === "manual" }
    });
  }
  return globals;
}

function candidate(id, number, date, version = "", anime = ANIME) {
  return {
    anime,
    episode: { episodeId: id, episodeNumber: number, episodeTitle: `【youku】 第${number}期 ${date} ${version}`.trim() },
    index: number - 1,
    score: 20000 - number
  };
}

function episodes() {
  return [candidate("wrong", 3, "2019-02-08"), candidate("right", 13, "2019-03-15")];
}

test("FongMi dates support month/day filenames without interpreting size as a date", () => {
  for (const raw of [RAW, "03-15期.mkv", "3月15日", "03/15", "[3.15 GB] 03.15期.mp4"]) {
    assert.deepEqual(extractFongmiEpisodeDate(raw), { year: null, month: 3, day: 15 }, raw);
  }
  for (const raw of ["2019-03-15期", "2019.3.15", "2019年3月15日", "20190315期"]) {
    assert.deepEqual(extractFongmiEpisodeDate(raw), { year: 2019, month: 3, day: 15 }, raw);
  }
  for (const raw of ["第3期", "03.mp4", "S01E03.mkv", "第3.5集", "S01E03.15", "[1.30GB] 03.mp4", "13.15期", "02.30期", "2019-02-29", "2019-13-15"]) {
    assert.equal(extractFongmiEpisodeDate(raw), null, raw);
  }
  assert.deepEqual(extractFongmiEpisodeDate("02.29期"), { year: null, month: 2, day: 29 });
  assert.deepEqual(extractFongmiEpisodeDate("2020-02-29"), { year: 2020, month: 2, day: 29 });
});

test("FongMi date matching selects March 15 after the original scoring in either candidate order", async () => {
  for (const ordered of [episodes(), episodes().reverse()]) {
    const globals = reset();
    const candidates = ordered.map(item => ({
      ...item,
      score: scoreFongmiEpisodeMatch(item.anime, item.episode, RAW, item.index)
    })).sort((a, b) => b.score - a.score);
    const selected = await selectFongmiCandidateByAi(globals, NAME, RAW, candidates);
    assert.equal(selected?.episode.episodeId, "right");
    assert.deepEqual(candidates, [selected]);
  }
});

for (const preference of [false, true, "manual"]) {
  test(`FongMi selects March 15 instead of episode 3 with preference=${preference}`, async () => {
    const globals = reset(preference);
    const candidates = episodes();
    const selected = await selectFongmiCandidateByAi(globals, NAME, RAW, candidates);
    assert.equal(selected?.episode.episodeId, "right");
    assert.deepEqual(candidates, [selected]);
  });
}

test("FongMi full dates distinguish years instead of using only month/day", async () => {
  const globals = reset(true);
  const candidates = [candidate("next-year", 3, "2020-03-15"), ...episodes()];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "2019-03-15期.mp4", candidates);
  assert.equal(selected?.episode.episodeId, "right");
});

test("FongMi date-shaped period numbers match by date rather than episode ordinal", async () => {
  for (const preference of [false, true, "manual"]) {
    const globals = reset(preference);
    const candidates = episodes();
    const selected = await selectFongmiCandidateByAi(globals, NAME, "第20190315期.mp4", candidates);
    assert.equal(selected?.episode.episodeId, "right");
    assert.deepEqual(candidates, [selected]);
  }
});

test("FongMi candidate date-shaped period numbers do not hide an actual episode ordinal", async () => {
  const globals = reset("manual");
  const item = candidate("right", 13, "");
  item.episode.episodeTitle = "【youku】 第20190315期";
  const candidates = [item];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期 2019-03-15.mp4", candidates);
  assert.equal(selected?.episode.episodeId, "right");
});

test("FongMi retains a real explicit ordinal following a date-shaped period number", async () => {
  const globals = reset("manual");
  const candidates = episodes();
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第20190315期 第14期.mp4", candidates);
  assert.equal(selected, null);
  assert.deepEqual(candidates, []);
});

test("FongMi unique dated special versions are not selected automatically without AI", async () => {
  for (const version of ["预告", "花絮", "会员版", "纯享版", "加更", "先导片"]) {
    const globals = reset("manual");
    const candidates = [candidate("special", 13, "2019-03-15", version)];
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null, version);
    assert.deepEqual(candidates, [], version);
  }
});

test("FongMi unique dated special versions reach AI even when the input has no version label", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const version of ["预告", "花絮", "会员版"]) {
    const globals = reset("manual");
    globals.aiValid = true;
    globals.aiApiKey = "test-key";
    globals.aiBaseUrl = "https://ai.invalid";
    const candidates = [candidate("special", 13, "2019-03-15", version)];
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
    assert.deepEqual(candidates, []);
  }
  assert.equal(fetch.mock.callCount(), 3);
});

test("FongMi title overlap cannot auto-select an undated trailer", async () => {
  const globals = reset("manual");
  const candidates = [candidate("trailer", 13, "", "预告 沈腾宋小宝脑洞大开")];
  assert.equal(await selectFongmiCandidateByAi(globals, NAME, "03.15期 沈腾宋小宝脑洞大开.mp4", candidates), null);
  assert.deepEqual(candidates, []);
});

test("FongMi AI can still confirm an explicitly requested trailer", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":"trailer"}' } }] }));
  const candidates = [candidate("trailer", 13, "2019-03-15", "预告")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "03.15期预告.mp4", candidates);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(selected?.episode.episodeId, "trailer");
});

test("FongMi dates cannot override an explicit episode number", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("wrong episode must not reach AI"); });
  for (const preference of [false, true, "manual"]) {
    for (const prefix of ["第13期", "EP13", "S01E13", "Episode 13", "Episode13", "episode 13", "EPISODE13"]) {
      const globals = reset(preference);
      globals.aiValid = true;
      globals.aiApiKey = "test-key";
      const candidates = [candidate("wrong-number", 14, "2019-03-15")];
      assert.equal(await selectFongmiCandidateByAi(globals, NAME, `${prefix} 2019-03-15.mp4`, candidates), null);
      assert.deepEqual(candidates, []);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi dates preserve Episode ordinals when several episodes share a date", async () => {
  for (const preference of [false, true, "manual"]) {
    for (const prefix of ["Episode 13", "Episode13", "episode 13", "EPISODE13"]) {
      for (const englishTitles of [false, true]) {
        const globals = reset(preference);
        const wrong = candidate("wrong-number", 14, "2019-03-15");
        const right = candidate("right", 13, "2019-03-15");
        if (englishTitles) {
          wrong.episode.episodeTitle = "【youku】 Episode14 2019-03-15";
          right.episode.episodeTitle = "【youku】 Episode 13 2019-03-15";
          // Source indexes can differ from the ordinal written in the title.
          wrong.episode.episodeNumber = 13;
          right.episode.episodeNumber = 14;
        }
        const candidates = [wrong, right];
        const raw = `${prefix} 2019-03-15.mp4`;
        const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
        assert.equal(selected?.episode.episodeId, "right", `${raw}: ${englishTitles}`);
        assert.deepEqual(candidates, [right]);
      }
    }
  }
});

test("FongMi preserves bracketed explicit ordinals in ordinary and dated filenames", async () => {
  for (const [open, close] of [["[", "]"], ["【", "】"], ["(", ")"], ["（", "）"]]) {
    for (const label of ["第13期", "第十三期", "Episode13", "S01E13"]) {
      for (const date of ["", "2019-03-15"]) {
        const globals = reset("manual");
        const wrong = candidate("wrong-number", 14, date);
        const right = candidate("right", 13, date);
        for (const raw of [`${open}${label}${close} ${date}.mp4`, `${date}${open}${label}${close}.mp4`]) {
          const candidates = [wrong, right];
          const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
          assert.equal(selected?.episode.episodeId, "right", raw);
          assert.deepEqual(candidates, [right]);
        }
      }
    }
  }
});

test("FongMi bracketed date ordinals cannot select a conflicting episode or reach AI", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("conflicting episode must not reach AI"); });
  for (const preference of [false, true, "manual"]) {
    for (const aiEnabled of [false, true]) {
      for (const label of ["[第13期]", "【第十三期】", "[Episode13]", "(S01E13)", "（第13期）"]) {
        const globals = reset(preference);
        globals.aiValid = aiEnabled;
        globals.aiApiKey = aiEnabled ? "test-key" : "";
        const candidates = [candidate("wrong-number", 14, "2019-03-15")];
        const raw = `${label} 2019-03-15.mp4`;
        assert.equal(await selectFongmiCandidateByAi(globals, NAME, raw, candidates), null, raw);
        assert.deepEqual(candidates, [], raw);
      }
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi collection metadata cannot override the filename episode or date", async () => {
  for (const preference of [true, "manual"]) {
    for (const metadata of ["【更新至第24集】", "[第1集-第24集合集]", "（测试剧全集第24集）"]) {
      for (const filename of ["03.mp4", "S01E03.mkv"]) {
        for (const raw of [`${filename}${metadata}`, `${metadata}${filename}`]) {
          const globals = reset(preference);
          const right = candidate("right", 3, "");
          const candidates = [candidate("collection-last", 24, ""), candidate("collection-first", 1, ""), right];
          const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
          assert.equal(selected?.episode.episodeId, "right", raw);
          assert.deepEqual(candidates, [right]);
        }
      }
    }
    const globals = reset(preference);
    const candidates = episodes();
    const raw = "03.15期.mp4【更新至第24期】";
    assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "right", raw);
  }
});

test("FongMi nested collection labels cannot leak ordinals, parts, or update dates", async () => {
  const brackets = [["[", "]"], ["【", "】"], ["(", ")"], ["（", "）"]];
  for (const [open, close] of brackets) {
    for (const [innerOpen, innerClose] of brackets) {
      for (const progress of ["更新至第24集下", "更新日期2026-11-12"]) {
        const metadata = `${open}测试剧${innerOpen}2019${innerClose} ${progress}${close}`;
        for (const filename of ["03.mp4", "03.15期.mp4"]) {
          for (const raw of [`${filename}${metadata}`, `${metadata}${filename}`]) {
            for (const preference of [true, "manual"]) {
              const globals = reset(preference);
              const dated = filename.includes("期");
              const right = candidate("right", dated ? 13 : 3, dated ? "2019-03-15" : "");
              const candidates = [candidate("wrong", 24, "2026-11-12", "下"), right];
              assert.deepEqual(extractFongmiEpisodeDate(raw), dated ? { year: null, month: 3, day: 15 } : null, raw);
              assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "right", raw);
              assert.deepEqual(candidates, [right], raw);
            }
          }
        }
      }
    }
  }
});

test("FongMi nested labels keep adjacent episode, date, and part labels separate", async () => {
  for (const [open, close] of [["[", "]"], ["【", "】"], ["(", ")"], ["（", "）"]]) {
    const globals = reset("manual");
    const upper = candidate("upper", 13, "2019-03-15", "上");
    const lower = candidate("lower", 13, "2019-03-15", "下");
    const raw = `${open}测试剧(2019) 更新至第24期上${close}${open}第13期(下)${close}[2019-03-15].mp4`;
    const candidates = [upper, lower];
    assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "lower", raw);
    assert.deepEqual(candidates, [lower], raw);
  }
});

test("FongMi collection metadata cannot supply a part constraint", async () => {
  for (const preference of [false, true, "manual"]) {
    for (const metadata of ["【更新至第24集下】", "[第1集上-第24集下合集]", "（全24集下）"]) {
      for (const filename of ["03.mp4", "03.15期.mp4"]) {
        for (const raw of [`${filename}${metadata}`, `${metadata}${filename}`]) {
          const globals = reset(preference);
          const right = filename.includes("期")
            ? candidate("right", 13, "2019-03-15") : candidate("right", 3, "");
          const candidates = [right];
          const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
          assert.equal((selected ?? candidates[0])?.episode.episodeId, "right", raw);
          assert.deepEqual(candidates, [right], raw);
        }
      }
    }
  }
});

test("FongMi update dates cannot replace the episode date or add a date constraint", async () => {
  for (const metadata of ["【更新日期2026-11-12】", "[更新至20261112期]", "（更新至11.12期）"]) {
    for (const filename of ["03.mp4", "03.15期.mp4"]) {
      for (const raw of [`${filename}${metadata}`, `${metadata}${filename}`]) {
        const globals = reset("manual");
        const dated = filename.includes("期");
        const right = candidate("right", dated ? 13 : 3, dated ? "2019-03-15" : "");
        const candidates = [right];
        assert.deepEqual(extractFongmiEpisodeDate(raw), dated ? { year: null, month: 3, day: 15 } : null, raw);
        assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "right", raw);
      }
    }
  }
  assert.deepEqual(extractFongmiEpisodeDate("[2019-03-15].mp4"), { year: 2019, month: 3, day: 15 });
});

test("FongMi filename years cannot override standalone bracket episode numbers", async () => {
  for (const preference of [true, "manual"]) {
    for (const label of ["[第13集]", "【Episode13】"]) {
      for (const year of ["2019", "2026"]) {
        for (const raw of [`测试剧.${year}.1080p.${label}.mkv`, `${label}.测试剧.${year}.mkv`]) {
          const globals = reset(preference);
          const right = candidate("right", 13, "");
          const candidates = [candidate("year", Number(year), ""), right];
          assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "right", raw);
          assert.deepEqual(candidates, [right], raw);
        }
      }
    }
  }
  for (const raw of ["2019.mp4", "第2019集.mp4", "[Episode2019].mkv"]) {
    const globals = reset("manual");
    const candidates = [candidate("large-ordinal", 2019, "")];
    assert.equal((await selectFongmiCandidateByAi(globals, NAME, raw, candidates))?.episode.episodeId, "large-ordinal", raw);
  }
});

test("FongMi filename episode takes priority over a conflicting standalone bracket label", async () => {
  for (const raw of ["S01E03.mkv[第24集]", "[第24集]S01E03.mkv", "03.mp4【第24集】", "【第24集】03.mp4"]) {
    const globals = reset("manual");
    const right = candidate("right", 3, "");
    const candidates = [candidate("bracket-episode", 24, ""), right];
    const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
    assert.equal(selected?.episode.episodeId, "right", raw);
    assert.deepEqual(candidates, [right]);
  }
});

test("FongMi technical metadata in the body cannot replace a standalone bracket episode", async () => {
  for (const metadata of ["1.30GB", "DD+5.1", "1080p", "H.265", "AAC 5.1"]) {
    for (const date of ["", "2019-03-15"]) {
      const globals = reset("manual");
      const right = candidate("right", 13, date);
      const candidates = [candidate("wrong-number", 1, date), right];
      const raw = `${metadata} [Episode13] ${date}.mkv`;
      const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
      assert.equal(selected?.episode.episodeId, "right", raw);
      assert.deepEqual(candidates, [right]);
    }
  }
});

test("FongMi standalone bracket part labels retain both the episode and requested part", async () => {
  for (const raw of ["[第13期下] 2019-03-15.mp4", "[Episode13 (下)] 2019-03-15.mp4"]) {
    const globals = reset("manual");
    const upper = candidate("upper", 13, "2019-03-15");
    upper.episode.episodeTitle = "【youku】 第13期上 2019-03-15";
    const lower = candidate("lower", 13, "2019-03-15");
    lower.episode.episodeTitle = "【youku】 第13期下 2019-03-15";
    const other = candidate("other-episode", 24, "2019-03-15");
    other.episode.episodeTitle = "【youku】 第24期下 2019-03-15";
    const candidates = [other, upper, lower];
    const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
    assert.equal(selected?.episode.episodeId, "lower", raw);
    assert.deepEqual(candidates, [lower]);
  }
});

test("FongMi dates cannot substitute an upper or unspecified part for a requested lower part", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("wrong part must not reach AI"); });
  for (const raw of ["第13期下 2019-03-15.mp4", "第13期(下) 2019-03-15.mp4", "03.15期_下.mp4"]) {
    const globals = reset("manual");
    globals.aiValid = true;
    globals.aiApiKey = "test-key";
    const candidates = [candidate("upper", 13, "2019-03-15"), candidate("unspecified", 13, "2019-03-15")];
    candidates[0].episode.episodeTitle = "【youku】 第13期上 2019-03-15";
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, raw, candidates), null);
    assert.deepEqual(candidates, []);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi can select the unique correct lower part without AI", async () => {
  const globals = reset("manual");
  const candidates = [candidate("upper", 13, "2019-03-15"), candidate("lower", 13, "2019-03-15")];
  candidates[0].episode.episodeTitle = "【youku】 第13期上 2019-03-15";
  candidates[1].episode.episodeTitle = "【youku】 第13期下 2019-03-15";
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期下 2019-03-15.mp4", candidates);
  assert.equal(selected?.episode.episodeId, "lower");
  assert.deepEqual(candidates, [selected]);
});

test("FongMi date matching preserves slash and pipe part constraints", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("wrong part must not reach AI"); });
  for (const separator of ["/", "|", "｜"]) {
    for (const aiEnabled of [false, true]) {
      for (const part of ["", "上"]) {
        const globals = reset("manual");
        globals.aiValid = aiEnabled;
        globals.aiApiKey = aiEnabled ? "test-key" : "";
        const item = candidate("wrong-part", 13, "2019-03-15");
        item.episode.episodeTitle = `【youku】 第13期${part} 2019-03-15`;
        const candidates = [item];
        const raw = `第13期${separator}下 2019-03-15.mp4`;
        assert.equal(await selectFongmiCandidateByAi(globals, NAME, raw, candidates), null, raw);
        assert.deepEqual(candidates, [], raw);
      }
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi date matching recognizes slash and pipe parts in requests and candidate titles", async () => {
  for (const requestSeparator of ["", "/", "|", "｜"]) {
    for (const candidateSeparator of ["", "/", "|", "｜"]) {
      const globals = reset("manual");
      const candidates = [candidate("upper", 13, "2019-03-15"), candidate("lower", 13, "2019-03-15")];
      candidates[0].episode.episodeTitle = `【youku】 第13期${candidateSeparator}上 2019-03-15`;
      candidates[1].episode.episodeTitle = `【youku】 第13期${candidateSeparator}下 2019-03-15`;
      const raw = `第13期${requestSeparator}下 2019-03-15.mp4`;
      const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
      assert.equal(selected?.episode.episodeId, "lower", `${raw}: ${candidateSeparator}`);
      assert.deepEqual(candidates, [selected]);
    }
  }
});

test("FongMi preserves explicit episode and part constraints in version selection by AI", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"member"}' } }] });
  });
  const candidates = [
    candidate("upper", 13, "2019-03-15"), candidate("lower", 13, "2019-03-15"),
    candidate("member", 13, "", "会员版"), candidate("wrong-number", 14, "2019-03-15")
  ];
  candidates[0].episode.episodeTitle = "【youku】 第13期上 2019-03-15";
  candidates[1].episode.episodeTitle = "【youku】 第13期下 2019-03-15";
  candidates[2].episode.episodeTitle = "【youku】 第13期下 会员版";
  candidates[3].episode.episodeTitle = "【youku】 第14期下 2019-03-15";
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期下 2019-03-15 会员版.mp4", candidates);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)).sort(), ["lower", "member"]);
  assert.equal(selected?.episode.episodeId, "member");
});

test("FongMi full dates keep matching month/day candidates available to AI", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"partial"}' } }] });
  });
  const candidates = [candidate("partial", 13, "03.15期"), candidate("wrong-year", 13, "2020-03-15"), candidate("wrong-day", 13, "03.18期")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "2019-03-15期.mp4", candidates);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)), ["partial"]);
  assert.equal(selected?.episode.episodeId, "partial");
});

test("FongMi full dates can confirm a month/day candidate with an explicit matching episode", async () => {
  const globals = reset("manual");
  const candidates = [candidate("partial", 13, "03.15期")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期 2019-03-15.mp4", candidates);
  assert.equal(selected?.episode.episodeId, "partial");
});

test("FongMi keeps a version missing its year alongside a version with the full date", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"partial-member"}' } }] });
  });
  const candidates = [candidate("regular", 13, "2019-03-15"), candidate("partial-member", 13, "03.15期", "会员版")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期 2019-03-15 会员版.mp4", candidates);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)).sort(), ["partial-member", "regular"]);
  assert.equal(selected?.episode.episodeId, "partial-member");
});

test("FongMi month/day ambiguity does not guess across years or works", async () => {
  for (const extra of [
    candidate("next-year", 15, "2020-03-15"),
    candidate("other-work", 13, "2019-03-15", "", { ...ANIME, animeId: 9000000 })
  ]) {
    const globals = reset();
    const candidates = [...episodes(), extra];
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
    assert.deepEqual(candidates, []);
  }
});

test("FongMi explicit work preference takes priority over an automatic preference on another key", async () => {
  const globals = reset("manual");
  globals.lastSelectMap.set("original-name", {
    preferBySeason: { default: 9000000 },
    sourceBySeason: { default: "youku" }
  });
  const candidates = [...episodes(), candidate("other-work", 13, "2019-03-15", "", { ...ANIME, animeId: 9000000 })];
  const selected = await selectFongmiCandidateByAi(globals, "original-name", RAW, candidates, NAME);
  assert.equal(selected?.episode.episodeId, "right");
});

test("FongMi ordinary episode numbers still use the existing preference matching", async () => {
  for (const raw of ["第3期", "03.mp4", "[1.30GB] 03.mp4", "[2026][1080p][DD+5.1] 03.mp4"]) {
    const globals = reset(true);
    const candidates = episodes();
    const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
    assert.equal(selected?.episode.episodeId, "wrong", raw);
  }
});

test("FongMi ordinary and dated requests share explicit episode and part rules", async () => {
  for (const prefix of ["第十三期", "Episode13", "S01E13"]) {
    for (const date of ["", "2019-03-15"]) {
      for (const separator of ["", "/", "|", "｜"]) {
        const globals = reset("manual");
        const upper = candidate("upper", 13, date);
        const lower = candidate("lower", 13, date);
        upper.episode.episodeTitle = `【youku】 第13期${separator}上 ${date}`.trim();
        lower.episode.episodeTitle = `【youku】 第13期${separator}下 ${date}`.trim();
        const candidates = [upper, lower];
        const raw = `${prefix}${separator}下 ${date}.mp4`;
        const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
        assert.equal(selected?.episode.episodeId, "lower", raw);
        assert.deepEqual(candidates, [lower]);
      }
    }
  }
});

test("FongMi ordinary part filtering preserves the remaining keyword work preference", async () => {
  const globals = reset(true);
  const otherAnime = { ...ANIME, animeId: 9000000, bangumiId: "preferred-lower" };
  globals.lastSelectMap.set("fallback-keyword", {
    preferBySeason: { default: otherAnime.animeId },
    sourceBySeason: { default: otherAnime.source }
  });
  const upper = candidate("upper", 13, "");
  upper.episode.episodeTitle = "【youku】 第13期上";
  const unrelated = candidate("unrelated-lower", 13, "", "", { ...ANIME, animeId: 9000001 });
  unrelated.episode.episodeTitle = "【youku】 第13期下";
  const right = candidate("preferred-lower", 13, "", "", otherAnime);
  right.episode.episodeTitle = "【youku】 第13期下";
  const candidates = [upper, unrelated, right];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "第13期下.mp4", candidates, "fallback-keyword");
  assert.equal(selected?.episode.episodeId, "preferred-lower");
  assert.deepEqual(candidates, [right]);
});

test("FongMi audio channel metadata does not override an ordinary episode or a real date", async () => {
  for (const audio of ["5.1声道", "DTS 5.1", "5.1 AAC", "7.1ch"]) {
    const globals = reset(true);
    const raw = `[1.30GB] 第03集 [${audio}].mkv`;
    assert.equal(extractFongmiEpisodeDate(raw), null, raw);
    const candidates = episodes();
    const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
    assert.equal(selected?.episode.episodeId, "wrong", raw);
    assert.deepEqual(extractFongmiEpisodeDate(`[${audio}] 03.15期.mp4`), { year: null, month: 3, day: 15 });
  }
});

test("FongMi DD+ audio metadata does not replace an episode number or a later date", async () => {
  for (const audio of ["DD+5.1", "DD+7.1", "DD+ 5.1", "5.1 DD+", "7.1 DD+"]) {
    const globals = reset(true);
    const raw = `第03集 [${audio}].mkv`;
    assert.equal(extractFongmiEpisodeDate(raw), null, raw);
    const numberedCandidates = episodes();
    const numbered = await selectFongmiCandidateByAi(globals, NAME, raw, numberedCandidates);
    assert.equal(numbered?.episode.episodeId, "wrong", raw);

    const datedRaw = `[${audio}] 03.15期.mp4`;
    assert.deepEqual(extractFongmiEpisodeDate(datedRaw), { year: null, month: 3, day: 15 }, datedRaw);
    const datedCandidates = [...episodes(), candidate("audio-date", 15, "2019-05-01")];
    const dated = await selectFongmiCandidateByAi(globals, NAME, datedRaw, datedCandidates);
    assert.equal(dated?.episode.episodeId, "right", datedRaw);
  }
});

test("FongMi does not guess among versions or missing dates without AI", async () => {
  for (const [raw, candidates] of [
    [RAW, [...episodes(), candidate("member", 14, "2019-03-15", "会员版")]],
    [RAW, episodes().slice(0, 1)],
    ["03.15期会员版.mp4", episodes()],
    ["03.15期_下.mp4", episodes()]
  ]) {
    const globals = reset(true);
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, raw, candidates), null);
    assert.deepEqual(candidates, []);
  }
});

test("FongMi date ambiguity sends every same-day version and original filename to AI", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  globals.aiModel = "test-model";
  const raw = "[1.30GB] 03.15期会员版.mp4";
  let payload;
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"member"}' } }] });
  });
  const candidates = [...episodes(), candidate("member", 14, "2019-03-15", "会员版")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, raw, candidates);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(payload.episodeRaw, raw);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)).sort(), ["member", "right"]);
  assert.equal(selected?.episode.episodeId, "member");
});

test("FongMi keeps an undated version of the same episode for AI without including unrelated episodes", async t => {
  const globals = reset("manual");
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"member"}' } }] });
  });
  const member = candidate("member", 13, "", "会员版");
  member.episode.episodeNumber = 14;
  const candidates = [...episodes(), member, candidate("unrelated", 12, "", "会员版"), candidate("conflicting-date", 13, "2019-03-18", "会员版")];
  const selected = await selectFongmiCandidateByAi(globals, NAME, "03.15期会员版.mp4", candidates);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)).sort(), ["member", "right"]);
  assert.equal(selected?.episode.episodeId, "member");
});

test("FongMi does not auto-select a dated episode while an undated version of that episode remains", async () => {
  const globals = reset(true);
  const candidates = [...episodes(), candidate("member", 13, "", "会员版")];
  assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
  assert.deepEqual(candidates, []);
});

test("FongMi missing dates reach AI even when episode 3 has a confident local score", async t => {
  const globals = reset(true);
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  let payload;
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] });
  });
  const candidates = [candidate("undated", 3, "")];
  assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(payload.episodeRaw, RAW);
  assert.deepEqual(candidates, []);
});

test("FongMi stops before calling AI when all candidate dates conflict", async t => {
  const globals = reset(true);
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("conflicting dates must not reach AI"); });
  const candidates = episodes().slice(0, 1);
  assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(candidates, []);
});

test("FongMi rejects AI IDs for candidates with a conflicting day or year", async t => {
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"wrong-date"}' } }] });
  });
  for (const date of ["2019-02-08", "2020-03-15"]) {
    const globals = reset("manual");
    globals.aiValid = true;
    globals.aiApiKey = "test-key";
    globals.aiBaseUrl = "https://ai.invalid";
    const candidates = [candidate("wrong-date", 3, date), candidate("undated", 13, "")];
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, "2019-03-15期.mp4", candidates), null);
    assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)), ["undated"]);
    assert.deepEqual(candidates, []);
  }
});

test("FongMi date matching preserves an explicit manual work restriction", async () => {
  const globals = reset("manual");
  const otherSeason = { ...ANIME, animeId: 9000000, animeTitle: "王牌对王牌 第五季" };
  const candidates = [episodes()[0], candidate("other-season", 13, "2019-03-15", "", otherSeason)];
  assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, candidates), null);
  assert.deepEqual(candidates, []);
});

test("FongMi API returns the March 15 comment URL from cached source results", async t => {
  const globals = reset(true);
  const items = episodes();
  const anime = {
    ...ANIME,
    links: items.map(({ episode }, index) => ({ id: 41055 + index, title: episode.episodeTitle, url: `https://test.invalid/${episode.episodeId}` }))
  };
  globals.animes = [anime];
  setSearchCache(`${NAME}::fongmi-source:youku`, [ANIME], new Map([[anime.bangumiId, anime]]));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("cached test must not access network"); });
  const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
  url.searchParams.set("name", NAME);
  url.searchParams.set("episode", RAW);
  const response = await getFongmiDanmaku(url, new Request(url));
  const body = await response.json();
  assert.equal(body.length, 1);
  assert.ok(body[0].name.includes("2019-03-15"));
  assert.equal(body[0].url, "https://test.invalid/api/v2/comment/41056?format=xml");
});
