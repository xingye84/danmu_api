import { globals } from "../../configs/globals.js";
import { getPreferAnimeId } from "../../utils/cache-util.js";
import { jsonResponse } from "../../utils/http-util.js";
import { log } from "../../utils/log-util.js";
import { searchAnime } from "../dandan-api.js";
import { normalizeFongmiDetailStoreEpisodeTitles } from "./fongmi-display-title.js";

function toSearchAnimes(searchData) {
  return Array.isArray(searchData?.animes) ? searchData.animes : [];
}

/**
 * 为“剧名2”这类媒体库标题生成明确的季度搜索词。
 * @param {string[]} keywords 已清洗的 FongMi 搜索词
 * @returns {string[]} 明确季度搜索词
 */
export function buildFongmiCompactSeasonKeywords(keywords) {
  const variants = [];

  for (const keyword of keywords) {
    const seasonMatch = String(keyword || "").match(/^(.*\D)([1-9]\d?)$/);
    if (!seasonMatch) continue;

    const variant = `${seasonMatch[1]}第${seasonMatch[2]}季`;
    if (!keywords.includes(variant) && !variants.includes(variant)) {
      variants.push(variant);
    }
  }

  return variants;
}

async function searchWithSourceOrder(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform, sources, cacheKeySuffix) {
  const response = await searchAnime(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform, {
    sourceOrderOverride: sources,
    cacheKeySuffix
  });
  normalizeFongmiDetailStoreEpisodeTitles(detailStore);
  return response;
}

async function searchWithDefaultSourceOrder(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform) {
  const response = await searchAnime(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform);
  normalizeFongmiDetailStoreEpisodeTitles(detailStore);
  return response;
}

export async function searchFongmiAnimeBySourcePreference(searchUrl, preferAnimeId = null, preferSource = null, detailStore = null, targetPlatform = null) {
  const keyword = searchUrl.searchParams.get("keyword");
  const [, savedSource] = getPreferAnimeId(keyword);
  const canUsePreferredSource = savedSource && globals.sourceOrderArr.includes(savedSource);

  if (!canUsePreferredSource) {
    return searchWithDefaultSourceOrder(searchUrl, preferAnimeId, preferSource, detailStore, targetPlatform);
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
