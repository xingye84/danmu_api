import { globals } from "../../configs/globals.js";
import { jsonResponse } from "../../utils/http-util.js";
import { log } from "../../utils/log-util.js";
import { writeCacheToFile } from "../../utils/cache-util.js";
import { setRedisKey } from "../../utils/redis-util.js";
import { setLocalRedisKey } from "../../utils/local-redis-util.js";

function persistLastSelectMap() {
  if (globals.localCacheValid) {
    writeCacheToFile("lastSelectMap", JSON.stringify(Object.fromEntries(globals.lastSelectMap)));
  }
  if (globals.redisValid) {
    setRedisKey("lastSelectMap", globals.lastSelectMap).catch(e => log("error", "Redis set error", e));
  }
  if (globals.localRedisValid) {
    setLocalRedisKey("lastSelectMap", globals.lastSelectMap);
  }
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function getEntry(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  return globals.lastSelectMap.get(normalized) || null;
}

function putEntry(key, value) {
  const normalized = normalizeKey(key);
  if (!normalized || !value) return "";
  if (globals.lastSelectMap.has(normalized)) {
    globals.lastSelectMap.delete(normalized);
  }
  globals.lastSelectMap.set(normalized, value);
  if (globals.lastSelectMap.size > globals.MAX_LAST_SELECT_MAP) {
    const firstKey = globals.lastSelectMap.keys().next().value;
    globals.lastSelectMap.delete(firstKey);
    log("info", `[Fongmi][ManualCorrection] removed earliest entry from lastSelectMap: ${firstKey}`);
  }
  return normalized;
}

function buildManualCorrectionEntry(oldValue, animeId, source, searchName) {
  const animeIds = new Set(Array.isArray(oldValue?.animeIds) ? oldValue.animeIds : []);
  animeIds.add(animeId);
  const preferBySeason = oldValue?.preferBySeason ? { ...oldValue.preferBySeason } : {};
  const sourceBySeason = oldValue?.sourceBySeason ? { ...oldValue.sourceBySeason } : {};
  if (oldValue?.prefer !== undefined) preferBySeason.default = oldValue.prefer;
  if (oldValue?.source !== undefined) sourceBySeason.default = oldValue.source;
  preferBySeason.default = animeId;
  if (source) sourceBySeason.default = source;

  return {
    animeIds: [...animeIds],
    preferBySeason,
    ...(Object.keys(sourceBySeason).length > 0 && { sourceBySeason }),
    ...(oldValue?.offsets !== undefined && { offsets: oldValue.offsets }),
    ...(searchName && { fongmiCorrectedTitle: searchName })
  };
}

function rememberManualCorrection(originalName, searchName, animeId, source) {
  const originalKey = normalizeKey(originalName);
  const searchKey = normalizeKey(searchName);
  const selectedAnimeId = normalizeKey(animeId);
  const selectedSource = normalizeKey(source);
  if (!originalKey || !searchKey || !selectedAnimeId) return "";

  const originalEntry = buildManualCorrectionEntry(getEntry(originalKey), selectedAnimeId, selectedSource, searchKey);
  const updatedKey = putEntry(originalKey, originalEntry);

  if (searchKey !== originalKey) {
    const searchEntry = buildManualCorrectionEntry(getEntry(searchKey), selectedAnimeId, selectedSource, "");
    putEntry(searchKey, searchEntry);
  }

  persistLastSelectMap();
  return updatedKey;
}

async function parseManualCorrectionBody(req) {
  try {
    const clonedReq = req.clone();
    const contentType = (clonedReq.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) return await clonedReq.json();
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await clonedReq.formData();
      return Object.fromEntries(form.entries());
    }
    const text = await clonedReq.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      return Object.fromEntries(new URLSearchParams(text).entries());
    }
  } catch (e) {
    log("warn", `[Fongmi][ManualCorrection] parse body failed: ${e.message}`);
    return {};
  }
}

export function getFongmiCorrectedTitle(name) {
  const entry = getEntry(name);
  return normalizeKey(entry?.fongmiCorrectedTitle);
}

export async function handleFongmiManualCorrection(req) {
  const body = await parseManualCorrectionBody(req);
  const originalName = normalizeKey(body?.originalName || body?.originalTitle || body?.name);
  const searchName = normalizeKey(body?.searchName || body?.correctedName || body?.keyword);
  const animeId = normalizeKey(body?.animeId || body?.bangumiId);
  const source = normalizeKey(body?.source);
  const episodeId = normalizeKey(body?.episodeId || body?.commentId);

  if (!originalName || !searchName || !animeId || !episodeId) {
    return jsonResponse({
      success: false,
      remembered: false,
      errorMessage: "missing required manual correction fields"
    }, 200);
  }

  const key = rememberManualCorrection(originalName, searchName, animeId, source);
  log("info", `[Fongmi][ManualCorrection] remembered: key=${key}, search=${searchName}, animeId=${animeId}, source=${source || ""}, episodeId=${episodeId}`);

  return jsonResponse({
    success: true,
    remembered: Boolean(key),
    key,
    searchName
  }, 200);
}
