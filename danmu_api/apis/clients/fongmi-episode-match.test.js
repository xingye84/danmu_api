import assert from "node:assert/strict";
import test from "node:test";

import { Globals } from "../../configs/globals.js";
import { selectFongmiCandidateByAi } from "./fongmi-ai-match.js";

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
