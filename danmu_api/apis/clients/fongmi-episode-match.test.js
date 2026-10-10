import assert from "node:assert/strict";
import test from "node:test";

import { Globals } from "../../configs/globals.js";
import { selectFongmiCandidateByAi } from "./fongmi-ai-match.js";
import { getFongmiDanmaku } from "./fongmi-api.js";
import { handleFongmiManualCorrection } from "./fongmi-manual-correction.js";
import { rememberFongmiCommentPreference } from "./fongmi-prefer.js";
import { getLastSearch, setSearchCache } from "../../utils/cache-util.js";

const RAW_EPISODE = "谁养谁亲密关系的背后.mp4【圆桌派 第3季.全24集】";

test("FongMi should match episode titles across punctuation differences", async () => {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.lastSelectMap.clear();

  const anime = {
    animeId: 209358,
    bangumiId: "efbfbd3cefbfbd64efbf",
    animeTitle: "圆桌派 第三季(2018)【电视剧】from youku",
    source: "youku"
  };
  globals.lastSelectMap.set("圆桌派第三季", {
    animeIds: [anime.animeId],
    preferBySeason: { default: anime.animeId },
    sourceBySeason: { default: anime.source }
  });

  const wrongCandidate = {
    anime,
    episode: {
      episodeId: "episode-4",
      episodeNumber: 4,
      episodeTitle: "【youku】 第4集 爱哭：何时你变得爱哭了？"
    },
    index: 3
  };
  const expectedCandidate = {
    anime,
    episode: {
      episodeId: "episode-12",
      episodeNumber: 12,
      episodeTitle: "【youku】 第12集 供养：谁养谁？亲密关系的背后"
    },
    index: 11
  };

  const candidates = [wrongCandidate, expectedCandidate];
  const selected = await selectFongmiCandidateByAi(
    globals,
    "圆桌派 第三季",
    RAW_EPISODE,
    candidates,
    "圆桌派第三季"
  );

  assert.equal(selected?.episode?.episodeId, "episode-12");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].episode.episodeId, "episode-12");

  globals.lastSelectMap.clear();
  const candidatesWithoutPreference = [wrongCandidate, expectedCandidate];
  const selectedWithoutPreference = await selectFongmiCandidateByAi(
    globals,
    "圆桌派 第三季",
    RAW_EPISODE,
    candidatesWithoutPreference,
    "圆桌派第三季"
  );

  assert.equal(selectedWithoutPreference?.episode?.episodeId, "episode-12");
  assert.equal(candidatesWithoutPreference.length, 1);
  assert.equal(candidatesWithoutPreference[0].episode.episodeId, "episode-12");
});

test("FongMi should ignore a leading question phrase in the raw title", async () => {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.lastSelectMap.clear();

  const anime = {
    animeId: 209358,
    bangumiId: "efbfbd3cefbfbd64efbf",
    animeTitle: "圆桌派 第三季(2018)【电视剧】from youku",
    source: "youku"
  };
  globals.lastSelectMap.set("圆桌派第三季", {
    animeIds: [anime.animeId],
    preferBySeason: { default: anime.animeId },
    sourceBySeason: { default: anime.source }
  });

  const candidates = [
    {
      anime,
      episode: {
        episodeId: "episode-4",
        episodeNumber: 4,
        episodeTitle: "【youku】 第4集 爱哭：何时你变得爱哭了？"
      },
      index: 3,
      score: 11197
    },
    {
      anime,
      episode: {
        episodeId: "episode-13",
        episodeNumber: 13,
        episodeTitle: "【youku】 第13集 面对逆境 是消极退赛还是背水一战"
      },
      index: 12,
      score: 188
    }
  ];

  const selected = await selectFongmiCandidateByAi(
    globals,
    "圆桌派 第三季",
    "如何面对逆境.mp4【圆桌派 第3季.全24集】",
    candidates,
    "圆桌派第三季"
  );

  assert.equal(selected?.episode?.episodeId, "episode-13");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].episode.episodeId, "episode-13");
});

test("FongMi preferred anime should still match variety episode title text", async () => {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.lastSelectMap.clear();
  globals.lastSelectMap.set("音乐缘计划2", {
    animeIds: [4844838],
    preferBySeason: { default: 4844838 },
    sourceBySeason: { default: "iqiyi" }
  });

  const anime = {
    animeId: 4844838,
    bangumiId: "m6hj8g8o5w",
    animeTitle: "音乐缘计划第2季(2025)【综艺】from iqiyi",
    source: "iqiyi"
  };
  const candidates = [
    {
      anime,
      episode: {
        episodeId: "wrong",
        episodeTitle: "【qiyi】 先导片 周深冷笑话听懵薛之谦 先导片 周深冷笑话听懵薛之谦 黄子弘凡开局就罢录"
      }
    },
    {
      anime,
      episode: {
        episodeId: "right",
        episodeTitle: "【qiyi】 年度盛典 周深刘宇宁限定合唱！ 年度盛典 周深刘宇宁限定合唱！薛之谦张靓颖《霸王别姬》回忆杀"
      }
    }
  ];

  const selected = await selectFongmiCandidateByAi(
    globals,
    "音乐缘计划2",
    "[2.6 GB]20260102 年度盛典 周深刘宇宁限定合唱！.mkv【Y-音-粤-缘-寄-划-2】",
    candidates,
    "音乐缘计划2"
  );

  assert.equal(selected?.episode?.episodeId, "right");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].episode.episodeId, "right");
});

test("FongMi preferred anime should not use generic title words across explicit episode numbers", async () => {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.lastSelectMap.clear();
  globals.lastSelectMap.set("测试综艺", {
    animeIds: [1001],
    preferBySeason: { default: 1001 },
    sourceBySeason: { default: "iqiyi" }
  });

  const anime = {
    animeId: 1001,
    bangumiId: "test-show",
    animeTitle: "测试综艺(2026)【综艺】from iqiyi",
    source: "iqiyi"
  };
  const candidates = [
    {
      anime,
      episode: {
        episodeId: "ep3",
        episodeTitle: "【qiyi】 第3期纯享版 歌手舞台纯享"
      }
    }
  ];

  const selected = await selectFongmiCandidateByAi(
    globals,
    "测试综艺",
    "第2期 纯享版.mkv",
    candidates,
    "测试综艺"
  );

  assert.equal(selected, null);
  assert.equal(candidates.length, 1);
});

test("FongMi preferred anime should use episodeNumber when title has a suffix number", async () => {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.lastSelectMap.clear();

  const preferredAnime = {
    animeId: 2597187,
    bangumiId: "b467b61f66ef4f8d88786047dede8912",
    animeTitle: "京华春梦(粤)【剧集】from maiduidui",
    source: "maiduidui"
  };
  const otherAnime = {
    animeId: 4895232,
    bangumiId: "c53e59903c7c11eca22a9c7da384e5a3",
    animeTitle: "京华春梦(普通话)【剧集】from maiduidui",
    source: "maiduidui"
  };
  globals.lastSelectMap.set("https://pan.quark.cn/s/example", {
    animeIds: [preferredAnime.animeId],
    preferBySeason: { default: preferredAnime.animeId },
    sourceBySeason: { default: preferredAnime.source },
    explicitBySeason: { default: true }
  });

  const candidates = [
    {
      anime: preferredAnime,
      episode: { episodeId: "30173", episodeNumber: 2, episodeTitle: "【maiduidui】 京华春梦(粤)02" },
      index: 1
    },
    {
      anime: otherAnime,
      episode: { episodeId: "30198", episodeNumber: 2, episodeTitle: "【maiduidui】 京华春梦(普通话)02" },
      index: 1
    }
  ];

  const selected = await selectFongmiCandidateByAi(
    globals,
    "https://pan.quark.cn/s/example",
    "Yesterdays.Glitter.S01E02.mkv",
    candidates,
    "京华春梦"
  );

  assert.equal(selected?.episode?.episodeId, "30173");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].anime.animeId, preferredAnime.animeId);
});

const MENGTAN_NAME = "https://pan.quark.cn/s/4ce098443535";
const MENGTAN_EPISODE = "[1.3GB]第13期下 萌探家族拯救朱朝阳.mp4【萌探探探案/萌探1】";
const MENGTAN_FIRST = { animeId: 8895950, bangumiId: "23l8oul8zos", animeTitle: "萌探探探案第1季(2021)【综艺】from iqiyi", source: "iqiyi" };
const MENGTAN_SECOND = { animeId: 8256680, bangumiId: "249m6jnptgg", animeTitle: "萌探探探案第2季(2022)【综艺】from iqiyi", source: "iqiyi" };

function resetMatchConfig() {
  Globals.init({});
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = "";
  globals.localCacheValid = globals.redisValid = globals.localRedisValid = false;
  globals.lastSelectMap.clear();
  globals.searchCache.clear();
  globals.favoriteCache.clear();
  globals.animes = [];
  globals.sourceOrderArr = ["iqiyi"];
  globals.enableAnimeEpisodeFilter = false;
  return globals;
}

function mengtanCandidates() {
  return [
    { anime: MENGTAN_SECOND, episode: { episodeId: 30618, episodeTitle: "【qiyi】 第13期下(一) 那英华晨宇成团竞演 第13期下 那英华晨宇成团竞演 baby马丽被虐哭" }, score: 7200 },
    { anime: MENGTAN_FIRST, episode: { episodeId: 30487, episodeTitle: "【qiyi】 第13期下(一) 萌探家族拯救朱朝阳 杨紫化身夏雪爷青回 萌探家族暖心拯救朱朝阳" }, score: 7100 },
    { anime: MENGTAN_FIRST, episode: { episodeId: 30488, episodeTitle: "【qiyi】 第13期下(二) 杨紫看老年夏东海泪崩 杨紫化身夏雪爷青回 萌探家族暖心拯救朱朝阳" }, score: 7099 }
  ];
}

async function rememberMengtan() {
  const req = new Request("https://test.invalid/api/v2/fongmi/manual-correction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ originalName: MENGTAN_NAME, searchName: "萌探探探案", animeId: MENGTAN_FIRST.animeId, source: "iqiyi", episodeId: 30487 })
  });
  assert.equal((await (await handleFongmiManualCorrection(req)).json()).remembered, true);
}

test("FongMi should reuse the manually confirmed first season from the reported log", async () => {
  const globals = resetMatchConfig();
  await rememberMengtan();
  // The original playback key takes precedence over a later generic-title preference.
  globals.lastSelectMap.get("萌探探探案").preferBySeason.default = MENGTAN_SECOND.animeId;
  const candidates = mengtanCandidates();
  const selected = await selectFongmiCandidateByAi(globals, MENGTAN_NAME, MENGTAN_EPISODE, candidates, "萌探探探案");
  assert.equal(selected?.episode.episodeId, 30487);
  assert.deepEqual(candidates, [selected]);
  assert.equal(globals.lastSelectMap.get(MENGTAN_NAME).preferBySeason.default, String(MENGTAN_FIRST.animeId));
});

test("FongMi should recognize part labels followed by split numbers", async () => {
  const globals = resetMatchConfig();
  for (const suffix of ["(一)", "（二）", "(1)", "（2）"]) {
    const candidate = { anime: MENGTAN_FIRST, episode: { episodeId: 30487, episodeTitle: `【qiyi】 第13期下${suffix} 萌探家族拯救朱朝阳` } };
    const candidates = [candidate];
    await selectFongmiCandidateByAi(globals, "萌探探探案", MENGTAN_EPISODE, candidates);
    assert.deepEqual(candidates, [candidate], suffix);
  }
});

test("FongMi should not substitute another season or episode for a manual selection", async () => {
  const globals = resetMatchConfig();
  await rememberMengtan();
  for (const candidates of [
    [mengtanCandidates()[0]],
    [{ anime: MENGTAN_FIRST, episode: { episodeId: 30000, episodeTitle: "【qiyi】 第12期下 萌探家族拯救朱朝阳" } }],
    [{ anime: MENGTAN_FIRST, episode: { episodeId: 30001, episodeTitle: "【qiyi】 第13期上 萌探家族拯救朱朝阳" } }]
  ]) {
    const selected = await selectFongmiCandidateByAi(globals, MENGTAN_NAME, MENGTAN_EPISODE, candidates, "萌探探探案");
    assert.equal(selected, null);
    assert.deepEqual(candidates, []);
  }
});

test("FongMi should stop when AI declines a candidate", async t => {
  const globals = resetMatchConfig();
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  globals.aiModel = "test-model";
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: '{"candidateId":null}' } }] }));
  const candidates = mengtanCandidates().slice(0, 2);
  const selected = await selectFongmiCandidateByAi(globals, "萌探探探案", "第13期下 未知专题.mp4", candidates);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(selected, null);
  assert.deepEqual(candidates, []);
});

test("FongMi should send the corrected title and stop on AI failure within a manual work", async t => {
  const globals = resetMatchConfig();
  await rememberMengtan();
  globals.aiValid = true;
  globals.aiApiKey = "test-key";
  globals.aiBaseUrl = "https://ai.invalid";
  globals.aiModel = "test-model";
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ error: { message: "test failure" } }, { status: 503 });
  });
  const candidates = mengtanCandidates().slice(1);
  const selected = await selectFongmiCandidateByAi(globals, MENGTAN_NAME, "第13期下 未知专题.mp4", candidates, "萌探探探案");
  assert.equal(payload.name, "萌探探探案");
  assert.equal(payload.groups.length, 1);
  assert.equal(payload.groups[0].animeTitle, MENGTAN_FIRST.animeTitle);
  assert.equal(selected, null);
  assert.deepEqual(candidates, []);
});

test("FongMi automatic loading should record the final episode without overwriting manual preference", async t => {
  const globals = resetMatchConfig();
  await rememberMengtan();
  const candidates = mengtanCandidates();
  const details = [MENGTAN_FIRST, MENGTAN_SECOND].map(anime => ({
    ...anime,
    links: candidates.filter(candidate => candidate.anime === anime).map(candidate => ({ id: candidate.episode.episodeId, title: candidate.episode.episodeTitle, url: `https://test.invalid/video/${candidate.episode.episodeId}` }))
  }));
  globals.animes = details;
  setSearchCache("萌探探探案::fongmi-source:iqiyi", [MENGTAN_SECOND, MENGTAN_FIRST], new Map(details.map(anime => [anime.bangumiId, anime])));
  t.mock.method(globalThis, "fetch", async () => { throw new Error("cached matching must not use the network"); });
  const url = new URL("https://test.invalid/api/v2/fongmi/danmaku");
  url.searchParams.set("name", MENGTAN_NAME);
  url.searchParams.set("episode", MENGTAN_EPISODE);
  const items = await (await getFongmiDanmaku(url, new Request(url), "test-ip")).json();
  assert.equal(items.length, 1);
  assert.match(items[0].url, /\/comment\/30487\?format=xml$/);
  assert.equal(getLastSearch("test-ip").episodeId, 30487);
  const before = JSON.stringify([...globals.lastSelectMap]);
  rememberFongmiCommentPreference(30487, MENGTAN_FIRST.animeTitle, "test-ip");
  assert.equal(JSON.stringify([...globals.lastSelectMap]), before);
});


test("FongMi should not guess within a manual work when AI is unavailable", async () => {
  const globals = resetMatchConfig();
  await rememberMengtan();
  for (const episode of ["第13期下 未知专题.mp4", "未知专题.mp4"]) {
    const candidates = mengtanCandidates().slice(1);
    const selected = await selectFongmiCandidateByAi(globals, MENGTAN_NAME, episode, candidates, "萌探探探案");
    assert.equal(selected, null);
    assert.deepEqual(candidates, []);
  }
});
