import assert from "node:assert/strict";
import test from "node:test";

import { Globals } from "../../configs/globals.js";
import { setSearchCache } from "../../utils/cache-util.js";
import { decodeIqiyiConcat, prepareIqiyiFongmiEpisodes } from "../../utils/iqiyi-concat-util.js";
import { selectFongmiCandidateByAi } from "./fongmi-ai-match.js";
import { getFongmiDanmaku, scoreFongmiEpisodeMatch } from "./fongmi-api.js";

const NAME = "奔跑吧兄弟 第四季";
const KEYWORD = "奔跑吧兄弟第四季";
const RAW = "[1.73GB] 奔跑吧兄弟 - S04E05 - WEB1080P.20160513.野营大作战.mp4";
const ANIME = {
  animeId: 5546496,
  bangumiId: "19rrmacgqs",
  animeTitle: "奔跑吧兄弟第4季(2016)【综艺】from iqiyi",
  source: "iqiyi"
};
const EPISODES = [
  { episodeId: 12, episodeTitle: "【qiyi】 第4期 鹿晗三连冠 张天爱护祖蓝", url: "https://www.iqiyi.com/v_19rrlvwiyc.html" },
  { episodeId: 13, episodeTitle: "【qiyi】 第5期(一) 中韩跑男特辑 祖蓝光洙被虐", url: "https://www.iqiyi.com/v_19rrltvmi8.html" },
  { episodeId: 14, episodeTitle: "【qiyi】 第5期(二) 邓超刘在石配合超默契 中韩跑男特辑 祖蓝光洙被虐", url: "https://www.iqiyi.com/v_1y45eo1kr3k.html" },
  { episodeId: 15, episodeTitle: "【qiyi】 第5期(三) 郑恺偷袭李晨宋智孝 中韩跑男特辑 祖蓝光洙被虐", url: "https://www.iqiyi.com/v_vzpf6xvugs.html" },
  { episodeId: 16, episodeTitle: "【qiyi】 第6期 李晨竟遭秒撕 郑恺复仇Rain", url: "https://www.iqiyi.com/v_19rrls2n4w.html" }
];

function reset(preference = false, aiEnabled = true) {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = aiEnabled;
  globals.aiApiKey = aiEnabled ? "test-key" : "";
  globals.aiBaseUrl = "https://ai.invalid";
  globals.sourceOrderArr = ["iqiyi"];
  globals.enableAnimeEpisodeFilter = false;
  globals.lastSelectMap.clear();
  globals.searchCache.clear();
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

function candidates(episodes = EPISODES, raw = RAW) {
  return prepareIqiyiFongmiEpisodes(episodes, raw)
    .map((episode, index) => ({ anime: ANIME, episode, index, score: scoreFongmiEpisodeMatch(ANIME, episode, raw, index) }))
    .sort((a, b) => b.score - a.score);
}

test("FongMi explicit episode keeps matching an undated variety issue despite different titles", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("an explicit matching issue must not reach AI");
  });
  for (const preference of [false, true, "manual"]) {
    for (const aiEnabled of [false, true]) {
      const globals = reset(preference, aiEnabled);
      const items = candidates();
      await selectFongmiCandidateByAi(globals, NAME, RAW, items, KEYWORD);
      assert.equal(items.length, 1);
      assert.equal(items[0].episode.episodeId, 13);
      assert.deepEqual(decodeIqiyiConcat(items[0].episode.iqiyiConcatUrl), EPISODES.slice(1, 4).map(item => item.url));
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi explicit episode still excludes candidates with conflicting dates", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("a conflicting date must not reach AI");
  });
  for (const preference of [false, true, "manual"]) {
    for (const date of ["2016-05-20", "2017-05-13"]) {
      const globals = reset(preference);
      const wrong = { ...EPISODES[0], episodeTitle: `【qiyi】 第5期 ${date}` };
      const items = candidates([wrong]);
      assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, items, KEYWORD), null);
      assert.deepEqual(items, []);

      const mixed = candidates([wrong, ...EPISODES.slice(1)]);
      await selectFongmiCandidateByAi(globals, NAME, RAW, mixed, KEYWORD);
      assert.deepEqual(mixed.map(item => item.episode.episodeId), [13]);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi date-only filenames cannot use undated episode numbers as a substitute", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const raw of ["03.15期.mp4", "20160513.mp4", "第20160513期.mp4"]) {
    const globals = reset(true);
    const items = candidates(EPISODES, raw);
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, raw, items, KEYWORD), null);
    assert.deepEqual(items, []);
  }
  assert.equal(fetch.mock.callCount(), 3);
});

test("FongMi explicit dated episodes keep ambiguous versions available to AI", async t => {
  const globals = reset("manual");
  let payload;
  const fetch = t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: '{"candidateId":"member"}' } }] });
  });
  const member = { episodeId: "member", episodeTitle: "【qiyi】 第5期 会员版", url: "https://www.iqiyi.com/v_member.html" };
  const raw = `${RAW} 会员版`;
  const items = candidates([...EPISODES, member], raw);
  const selected = await selectFongmiCandidateByAi(globals, NAME, raw, items, KEYWORD);
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(payload.groups.flatMap(group => group.episodes.map(([id]) => id)).sort(), ["13", "member"]);
  assert.equal(selected?.episode.episodeId, "member");
});

test("FongMi does not directly select an unmerged numbered part for a whole issue", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const label of ["(一)", "（2）", "(三)"]) {
    const globals = reset();
    const part = { ...EPISODES[1], episodeTitle: `【qiyi】 第5期${label} 中韩跑男特辑` };
    const items = candidates([part]);
    assert.equal(await selectFongmiCandidateByAi(globals, NAME, RAW, items), null, label);
    assert.deepEqual(items, [], label);
  }
  assert.equal(fetch.mock.callCount(), 3);
});

test("FongMi can directly select an explicitly requested numbered part", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("the requested numbered part must not reach AI");
  });
  for (const label of ["(一)", "（2）", "(三)"]) {
    const globals = reset();
    const part = { ...EPISODES[1], episodeTitle: `【qiyi】 第5期${label} 中韩跑男特辑` };
    const raw = `第5期${label} 20160513.mkv`;
    const items = candidates([part], raw);
    const selected = await selectFongmiCandidateByAi(globals, NAME, raw, items);
    assert.equal(selected?.episode.episodeId, part.episodeId, label);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi does not directly select a conflicting season from a generic title search", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const prefix of ["S04E05", "Season 4 EP05", "第4季第5期", "4x05 第5期", "[4x05] 第5期"]) {
    const globals = reset();
    const raw = `${prefix} 20160513.mkv`;
    const items = candidates(EPISODES, raw);
    for (const item of items) {
      item.anime = { ...ANIME, animeTitle: "奔跑吧兄弟第3季(2015)【综艺】from iqiyi" };
    }
    assert.equal(await selectFongmiCandidateByAi(globals, "奔跑吧兄弟", raw, items), null, raw);
    assert.deepEqual(items, [], raw);
  }
  assert.equal(fetch.mock.callCount(), 5);
});

test("FongMi does not interpret an explicit issue number as a conflicting season", async t => {
  const globals = reset();
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("a matching issue without a season must not reach AI");
  });
  const raw = "第5期 20160513.mkv";
  const items = candidates(EPISODES, raw);
  const selected = await selectFongmiCandidateByAi(globals, NAME, raw, items);
  assert.equal(selected?.episode.episodeId, 13);
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi checks seasons in joined SxxExx filenames without blocking the matching season", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const marker of ["S04E05", "s04e05", "S4E5", "S04 E05"]) {
    for (const season of [3, 4]) {
      for (const aiEnabled of [true, false]) {
        const globals = reset(false, aiEnabled);
        const raw = `[DTS5.1][AVS3] RunningMan${marker}.20160513.野营大作战.mkv`;
        const items = candidates(EPISODES, raw);
        for (const item of items) item.anime = { ...ANIME, animeTitle: `奔跑吧兄弟第${season}季(2016)【综艺】from iqiyi` };
        const selected = await selectFongmiCandidateByAi(globals, "奔跑吧兄弟", raw, items);
        if (season === 4) {
          assert.equal(selected?.episode.episodeId, 13, raw);
        } else {
          assert.equal(selected, null, raw);
          assert.deepEqual(items, [], raw);
        }
      }
    }
  }
  assert.equal(fetch.mock.callCount(), 4);
});

test("FongMi API rejects a conflicting season in a joined filename", async t => {
  const globals = reset();
  const anime = {
    ...ANIME,
    animeTitle: "奔跑吧兄弟第3季(2015)【综艺】from iqiyi",
    links: EPISODES.map(item => ({ id: item.episodeId, title: item.episodeTitle, url: item.url }))
  };
  globals.animes = [anime];
  setSearchCache("奔跑吧兄弟", [anime], new Map([[anime.bangumiId, anime]]));
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
  url.searchParams.set("name", "奔跑吧兄弟");
  url.searchParams.set("episode", "RunningManS04E05.20160513.野营大作战.mkv");
  assert.deepEqual(await (await getFongmiDanmaku(url, new Request(url))).json(), []);
  assert.equal(fetch.mock.callCount(), 1);
});

test("FongMi checks numbered parts and seasons after title and date selection", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const incomplete of [true, false]) {
    for (const date of ["", "2016-05-13"]) {
      for (const aiEnabled of [true, false]) {
        const globals = reset(false, aiEnabled);
        const title = incomplete ? "【qiyi】 第5期(一) 中韩跑男特辑" : "【qiyi】 第5期 中韩跑男特辑";
        const raw = "[DTS5.1] S04E05 20160513 中韩跑男特辑.mkv";
        const items = candidates([{ ...EPISODES[1], episodeTitle: `${title} ${date}` }], raw);
        if (!incomplete) items[0].anime = { ...ANIME, animeTitle: "奔跑吧兄弟第3季(2015)【综艺】from iqiyi" };
        assert.equal(await selectFongmiCandidateByAi(globals, "奔跑吧兄弟", raw, items), null);
        assert.deepEqual(items, []);
      }
    }
  }
  assert.equal(fetch.mock.callCount(), 4);
});

test("FongMi audio and codec metadata cannot turn a matching dated issue into a season conflict", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("file metadata must not force a matching issue to AI");
  });
  for (const metadata of ["[DTS5.1]", "DTS5.1", "[AVS3]", "[channels5.1]"]) {
    for (const prefix of ["第5期", "S04E05"]) {
      for (const aiEnabled of [true, false]) {
        const globals = reset(false, aiEnabled);
        const raw = `${metadata} ${prefix} 20160513 野营大作战.mkv`;
        const items = candidates(EPISODES, raw);
        const selected = await selectFongmiCandidateByAi(globals, NAME, raw, items);
        assert.equal(selected?.episode.episodeId, 13, raw);
      }
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("FongMi API validates title fallback and ignores audio tags in season checks", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const kind of ["incomplete", "cross-season", "audio"]) {
    const globals = reset();
    const name = kind === "cross-season" ? "奔跑吧兄弟" : NAME;
    const raw = kind === "audio" ? "[DTS5.1] 第5期 20160513 野营大作战.mkv" : "S04E05 20160513 中韩跑男特辑.mkv";
    const anime = {
      ...ANIME,
      animeTitle: kind === "cross-season" ? "奔跑吧兄弟第3季(2015)【综艺】from iqiyi" : ANIME.animeTitle,
      links: (kind === "incomplete" ? [EPISODES[1]] : EPISODES).map(item => ({ id: item.episodeId, title: item.episodeTitle, url: item.url }))
    };
    globals.animes = [anime];
    setSearchCache(name.replace(/ /g, ""), [anime], new Map([[anime.bangumiId, anime]]));
    const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
    url.searchParams.set("name", name);
    url.searchParams.set("episode", raw);
    const items = await (await getFongmiDanmaku(url, new Request(url))).json();
    if (kind === "audio") {
      assert.equal(items.length, 1);
      assert.match(items[0].name, /第5期 中韩跑男特辑/);
    } else {
      assert.deepEqual(items, []);
    }
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("FongMi API keeps incomplete parts and conflicting seasons out of direct selection", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  for (const incomplete of [true, false]) {
    const globals = reset();
    const name = incomplete ? NAME : "奔跑吧兄弟";
    const anime = {
      ...ANIME,
      animeTitle: incomplete ? ANIME.animeTitle : "奔跑吧兄弟第3季(2015)【综艺】from iqiyi",
      links: (incomplete ? [EPISODES[1]] : EPISODES).map(item => ({ id: item.episodeId, title: item.episodeTitle, url: item.url }))
    };
    globals.animes = [anime];
    setSearchCache(name.replace(/ /g, ""), [anime], new Map([[anime.bangumiId, anime]]));
    const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
    url.searchParams.set("name", name);
    url.searchParams.set("episode", RAW);
    assert.deepEqual(await (await getFongmiDanmaku(url, new Request(url))).json(), []);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test("FongMi API returns the merged fifth issue for the reported dated filename", async t => {
  const globals = reset(true);
  const anime = { ...ANIME, links: EPISODES.map(item => ({ id: item.episodeId, title: item.episodeTitle, url: item.url })) };
  globals.animes = [anime];
  setSearchCache(`${KEYWORD}::fongmi-source:iqiyi`, [ANIME], new Map([[ANIME.bangumiId, anime]]));
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("cached matching must not use the network");
  });
  const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
  url.searchParams.set("name", NAME);
  url.searchParams.set("episode", RAW);
  const response = await getFongmiDanmaku(url, new Request(url));
  const items = await response.json();
  assert.equal(items.length, 1);
  assert.match(items[0].name, /第5期 中韩跑男特辑/);
  const commentUrl = new URL(items[0].url);
  assert.equal(commentUrl.pathname, "/api/v2/comment");
  assert.deepEqual(decodeIqiyiConcat(commentUrl.searchParams.get("url")), EPISODES.slice(1, 4).map(item => item.url));
  assert.equal(fetch.mock.callCount(), 0);
});
