import { getExplicitSeasonNumber, extractSeasonNumberFromAnimeTitle } from "../../utils/common-util.js";
import { isIqiyiFongmiPartCompatible } from "../../utils/iqiyi-concat-util.js";

// 日期、期数和标题产生的本地选择统一检查，未确认的候选仍交给 AI。
export function canSelectFongmiOrdinalCandidate(episode, candidate) {
  // 只向公共解析器传季号标记，排除“第N期”以及 DTS5.1、AVS3 等元数据中的 S。
  const seasonText = String(episode || "");
  const explicitSeason = seasonText.match(/S\d{1,2}\s*E\d{1,4}(?!\d)|第\s*[零〇一二三四五六七八九十百千万\d]+\s*[季部]|(?:^|[^A-Za-z0-9])(?:S(?:eason)?|Part)\s*\d+/i);
  const numberedSeason = seasonText.match(/(?:^|[^A-Za-z0-9])(\d{1,2})x\d{1,4}(?=$|[^A-Za-z0-9])/i);
  const targetSeason = getExplicitSeasonNumber(explicitSeason?.[0]) ?? (numberedSeason ? Number(numberedSeason[1]) : null);
  const candidateSeason = extractSeasonNumberFromAnimeTitle(candidate?.anime?.animeTitle || "").season;
  if (targetSeason >= 1 && targetSeason <= 50 && candidateSeason !== null && targetSeason !== candidateSeason) return false;

  return candidate?.anime?.source !== "iqiyi" || isIqiyiFongmiPartCompatible(candidate.episode, episode);
}
