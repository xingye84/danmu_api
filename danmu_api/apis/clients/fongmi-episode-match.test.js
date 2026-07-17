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
