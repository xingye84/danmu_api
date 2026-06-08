import { globals } from "../../configs/globals.js";
import { getPreferAnimeId } from "../../utils/cache-util.js";
import { jsonResponse } from "../../utils/http-util.js";
import { log } from "../../utils/log-util.js";
import { searchAnime } from "../dandan-api.js";

function toSearchAnimes(searchData) {
  return Array.isArray(searchData?.animes) ? searchData.animes : [];
}

async function searchWithSourceOrder(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform, sources, cacheKeySuffix) {
  return searchAnime(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform, {
    sourceOrderOverride: sources,
    cacheKeySuffix,
    cacheEmptyResults: true
  });
}

export async function searchFongmiAnimeBySourcePreference(searchUrl, preferAnimeId = null, preferSource = null, detailStore = null, targetPlatform = null) {
  const keyword = searchUrl.searchParams.get("keyword");
  const [, savedSource] = getPreferAnimeId(keyword);
  const canUsePreferredSource = savedSource && globals.sourceOrderArr.includes(savedSource);

  if (!canUsePreferredSource) {
    return searchAnime(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform);
  }

  const preferredRes = await searchWithSourceOrder(
    searchUrl,
    preferAnimeId,
    preferSource,
    detailStore,
    targetPlatform,
    [savedSource],
    `fongmi-source:${savedSource}`
  );
  const preferredData = await preferredRes.json();
  const preferredAnimes = toSearchAnimes(preferredData);
  if (preferredAnimes.length) {
    log("info", `[Fongmi][Prefer] search preferred source hit: keyword=${keyword}, source=${savedSource}, count=${preferredAnimes.length}`);
    return jsonResponse(preferredData, preferredRes.status);
  }

  const remainingSources = globals.sourceOrderArr.filter(source => source !== savedSource);
  log("info", `[Fongmi][Prefer] preferred source fallback: keyword=${keyword}, source=${savedSource}`);
  return searchWithSourceOrder(
    searchUrl,
    preferAnimeId,
    preferSource,
    detailStore,
    targetPlatform,
    remainingSources,
    `fongmi-source-fallback:${savedSource}:${remainingSources.join(",")}`
  );
}
