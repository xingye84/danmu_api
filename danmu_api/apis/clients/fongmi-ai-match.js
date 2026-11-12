import { log } from "../../utils/log-util.js";
import { getPreferAnimeId, setPreferByAnimeId, writeCacheToFile } from "../../utils/cache-util.js";
import { httpPost } from "../../utils/http-util.js";
import { setRedisKey } from "../../utils/redis-util.js";
import { setLocalRedisKey } from "../../utils/local-redis-util.js";
import { convertChineseNumber } from "../../utils/common-util.js";
import { canSelectFongmiOrdinalCandidate } from "./fongmi-ordinal-candidate.js";

const FONGMI_AI_STRONG_SCORE = 4000;
const FONGMI_AI_SAFE_SCORE_GAP = 5000;
const FONGMI_AI_COMPACT_LIMIT = 200;
const FONGMI_AI_REGULAR_GROUP_MIN_SIZE = 3;
const FONGMI_AI_REGULAR_GROUP_COVERAGE = 0.8;
const FONGMI_SPECIAL_EPISODE_VERSION_RE = /纯享|加更|花絮|先导|预告|番外|特别|彩蛋|会员|未播|直播|片段|舞台|合集|抢先|幕后/;
const FONGMI_AI_REGULAR_GROUP_UNSAFE_RE = new RegExp(`(?:第\\s*\\d+\\s*期|[上下中](?:\\s|$)|${FONGMI_SPECIAL_EPISODE_VERSION_RE.source})`);
const FONGMI_FILE_METADATA_RE = /\b(?:2160p|1080p|720p|4k|web-?dl|web-?rip|blu-?ray|hdr|dv|x265|x264|h\.?265|h\.?264|60fps|aac|flac|dts)\b/gi;
const FONGMI_EPISODE_LABEL_PAIRS = new Map([["[", "]"], ["【", "】"], ["(", ")"], ["（", "）"]]);
const FONGMI_EPISODE_TITLE_STOP_TOKENS = new Set([
  "正片",
  "纯享",
  "纯享版",
  "加更",
  "花絮",
  "先导",
  "先导片",
  "预告",
  "番外",
  "特别",
  "彩蛋",
  "会员",
  "未播",
  "直播",
  "片段",
  "舞台",
  "合集",
  "抢先",
  "幕后"
]);
const FONGMI_EPISODE_TITLE_QUESTION_PREFIX_RE = /^(?:如何|怎么|怎样|为何|为什么|是否)/;

const FONGMI_AI_MATCH_PROMPT = `你是影视弹幕候选选择器。你只负责从输入候选里选择最适合当前播放内容的一项。

输出必须是严格 JSON。不要输出 Markdown、代码块、解释、注释或多余文本。

输入 JSON 字段：
- name: 播放器传入的作品名
- episodeRaw: 播放器传入的原始集数、期数、日期、文件名或分集标题，不要假设已经被正确解析
- mode:
  - selectCandidate: 从 candidates/groups 中选择具体分集候选
  - selectGroup: 只从 groups 中选择作品组
- candidates: 可选的精简候选列表，每项为 [candidateId, animeTitle, source, episodeTitle]
- groups: 候选作品组
  - groupId: 作品组 ID
  - animeTitle/source/type/startDate: 作品组信息
  - sampleTitle/pattern/episodes: 规则标题组，episodes 每项为 [candidateId, episodeNo]
  - episodes: 普通标题组，episodes 每项为 [candidateId, episodeTitle]

选择规则，按优先级执行：
1. 先判断 name 与 animeTitle / aliases 是否是同一部作品；同名但类型、年份、别名明显不符时不要选。
2. 同名作品里，要特别区分动画、动漫、番剧、真人电视剧、电影、综艺、剧场版、特别篇。
3. 如果候选同时包含动画版和真人版，且 name 或候选信息不能证明当前是真人版，优先选择动画/动漫/番剧相关候选。
4. 再判断 episodeRaw 与 episodeTitle / pattern / episodeNo 是否匹配；集数、话数、期数、日期、上中下、纯享/加更等版本能精确匹配时优先。
5. 如果 episodeRaw 是文件名，例如 "[1.5 GB]\\"21.mp4\\""，要把其中真实分集理解为第 21 集，但不要被体积、清晰度、年份误导。
6. 综艺要同时看日期、期数、上/中/下、正片/纯享/加更/花絮等版本；同一天不同版本不要互相替代。
7. 规则标题组里的 pattern 只表示标题规律，episodes 里的 candidateId 才是可返回的真实候选。
8. localScore 只能作为参考；标题、类型或集数明显不匹配时，不要因为 localScore 高而选择。
9. 如果没有足够把握，返回 null，不要猜。

mode=selectCandidate 时，只能返回以下两种格式之一：
{"candidateId":"10057"}
{"candidateId":null}

如果你通过分集标题判断，也可以返回输入中精确存在的 episodeTitle：
{"episodeTitle":"【youku】 第22集 唐宫奇案之青雾风鸣 22"}

mode=selectGroup 时，只能返回以下两种格式之一：
{"groupId":"youku:2763893"}
{"groupId":null}`;

function buildFongmiAiChatRequest(globals, messages, options, payload = null) {
  const body = {
    model: options.model || globals.aiModel,
    temperature: options.temperature ?? 0.0,
    max_tokens: options.maxTokens ?? 8192,
    stream: false,
    messages
  };
  if (options.responseFormat) body.response_format = options.responseFormat;
  if (options.thinking) body.thinking = options.thinking;

  const request = {
    url: `${String(globals.aiBaseUrl || "").replace(/\/$/, "")}/chat/completions`,
    body
  };
  if (payload) request.payload = payload;
  return request;
}

function buildFongmiAiOptions(globals) {
  const options = {
    maxTokens: 2048,
    responseFormat: { type: "json_object" }
  };
  const baseUrl = String(globals.aiBaseUrl || "").toLowerCase();
  const model = String(globals.aiModel || "").toLowerCase();
  if (baseUrl.includes("deepseek") || model.includes("deepseek")) {
    options.thinking = { type: "disabled" };
  }
  return options;
}

function summarizeFongmiAiResponse(data) {
  return {
    id: data?.id || "",
    object: data?.object || "",
    model: data?.model || "",
    choices: (data?.choices || []).map(choice => {
      const message = choice?.message || {};
      const content = message.content || "";
      const reasoningContent = message.reasoning_content || "";
      return {
        index: choice?.index,
        finishReason: choice?.finish_reason,
        messageKeys: Object.keys(message),
        contentLength: content.length,
        contentPreview: content.slice(0, 200),
        reasoningContentLength: reasoningContent.length,
        reasoningContentPreview: reasoningContent.slice(0, 200)
      };
    }),
    usage: data?.usage || null
  };
}

function parseFongmiAiJson(aiResponse) {
  const text = String(aiResponse || "").trim();
  if (!text) return null;

  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```|```([\s\S]*?)\s*```|({[\s\S]*})/);
  const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[2] || jsonMatch[3]) : text;
  return JSON.parse(jsonString.trim());
}

function getCandidateAnimeId(candidate) {
  return candidate?.anime?.animeId ?? candidate?.anime?.bangumiId ?? null;
}

function getCandidateId(candidate) {
  return candidate?.episode?.episodeId ?? candidate?.episode?.commentId ?? candidate?.episode?.id ?? null;
}

function getCandidateSource(candidate) {
  return candidate?.anime?.source || null;
}

function sameCandidateWork(a, b) {
  const aId = getCandidateAnimeId(a);
  const bId = getCandidateAnimeId(b);
  const aSource = getCandidateSource(a);
  const bSource = getCandidateSource(b);
  return String(aId ?? "") === String(bId ?? "") && String(aSource ?? "") === String(bSource ?? "");
}

// 按配对括号处理整个标签，避免内层年份或上下集括号提前截断外层标签。
function replaceEpisodeLabels(value, replaceLabel) {
  const text = String(value || "");
  const closingBrackets = [];
  let result = "";
  let cursor = 0;
  let labelStart = 0;
  for (let index = 0; index < text.length; index++) {
    const closingBracket = FONGMI_EPISODE_LABEL_PAIRS.get(text[index]);
    if (closingBracket) {
      if (!closingBrackets.length) labelStart = index;
      closingBrackets.push(closingBracket);
    } else if (closingBrackets.length && text[index] === closingBrackets[closingBrackets.length - 1]) {
      closingBrackets.pop();
      if (!closingBrackets.length) {
        result += text.slice(cursor, labelStart) + replaceLabel(text.slice(labelStart, index + 1));
        cursor = index + 1;
      }
    }
  }
  return result + text.slice(cursor);
}

// 作品更新进度、全集数量和合集范围不能参与当前分集的任何约束。
function stripEpisodeCollectionMetadata(value) {
  return replaceEpisodeLabels(value, label =>
    /更新|全集|全\s*[零〇一二三四五六七八九十百\d]+\s*[集期话]|[集期话].*合集/.test(label) ? " " : label);
}

function extractEpisodeNoFromRawEpisode(episode) {
  let text = String(episode || "");
  if (!text) return null;

  const bracketEpisodeNos = [];
  text = replaceEpisodeLabels(text, label => {
    const content = label.slice(1, -1).trim();
    const parsed = extractExplicitEpisode(content);
    if (parsed?.index === 0) {
      const suffix = content.slice(parsed.text.length).replace(/[\s_.\/|｜\-（）()【】\[\]]/g, "");
      // 只接受独立集号及上下集标签，不能把更新进度或合集范围当成当前分集。
      if (!suffix || suffix === extractEpisodePartToken(content)) bracketEpisodeNos.push(parsed.value);
    }
    return " ";
  })
    .replace(/["'“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = stripEpisodeFileMetadata(text);

  const explicitEpisode = extractExplicitEpisode(text);
  if (explicitEpisode) return explicitEpisode.value;
  // 带日期时只接受显式集号，不能把 03.15 中的 03 当作第 3 期。
  if (!extractFongmiEpisodeDate(episode)) {
    // 存在明确括号集号时，正文中的年份不能抢占它；显式集号和普通数字正文仍优先。
    const numberText = bracketEpisodeNos.length ? text.replace(/(?:^|[^\d])(?:19|20)\d{2}(?=$|[^\d])/g, " ") : text;
    const match = numberText.match(/(?:^|[^\d])(\d{1,4})(?=$|[^\d])/);
    const value = match ? Number(match[1]) : 0;
    if (value > 0 && value < 10000) return String(value);
  }
  // 文件名正文优先，独立括号集号只作补充。
  return bracketEpisodeNos[0] ?? null;
}

function extractExplicitEpisode(value) {
  const regularEpisodeNo = extractRegularEpisodeNo(value);
  if (regularEpisodeNo) return regularEpisodeNo;

  const match = String(value || "").match(/(?:S\d{1,2}\s*E|\bE(?:P|pisode)?\.?\s*)(\d{1,4})(?!\d)/i);
  const episodeNo = match ? Number(match[1]) : 0;
  return episodeNo > 0 ? { value: String(episodeNo), text: match[0], index: match.index } : null;
}

function extractCandidateEpisodeNo(candidate) {
  const titleEpisodeNo = extractFocusedEpisodeNo(candidate?.episode?.episodeTitle || "");
  if (titleEpisodeNo !== null) return titleEpisodeNo;

  const episodeNumber = Number.parseInt(candidate?.episode?.episodeNumber, 10);
  return Number.isInteger(episodeNumber) && episodeNumber > 0 ? String(episodeNumber) : null;
}

function findRegularEpisodeCandidate(focus, candidates) {
  const targetEpisodeNo = focus.episodeNo;
  if (!targetEpisodeNo) return null;

  const regularPayload = buildRegularGroupPayload({ candidates });
  const match = regularPayload?.episodes?.find(([, episodeNo]) => String(episodeNo) === targetEpisodeNo);
  if (!match) return null;

  return candidates.find(candidate => String(getCandidateId(candidate)) === String(match[0])) || null;
}

function findFocusedEpisodeCandidate(focus, candidates) {
  if (!focus?.episodeNo) return null;

  let matches = candidates.filter(candidate =>
    String(extractCandidateEpisodeNo(candidate)) === String(focus.episodeNo)
  );
  if (!matches.length) return null;

  if (focus.partToken) {
    const partMatches = matches.filter(candidate => extractEpisodePartToken(candidate?.episode?.episodeTitle || "") === focus.partToken);
    if (partMatches.length) matches = partMatches;
  }

  return matches.length === 1 ? matches[0] : null;
}

function narrowFocusedCandidates(focus, candidates, manualWork) {
  const checkNumber = focus.episodeNo && (manualWork || focus.date || focus.partToken);
  const checkPart = focus.partToken && (focus.episodeNo || focus.date);
  if (!checkNumber && !checkPart) return false;

  const matches = candidates.filter(candidate => {
    const title = candidate?.episode?.episodeTitle || "";
    return (!checkNumber || extractCandidateEpisodeNo(candidate) === focus.episodeNo) &&
      (!checkPart || extractEpisodePartToken(title) === focus.partToken);
  });
  candidates.splice(0, candidates.length, ...matches);
  return !matches.length;
}

function keepOnlyCandidate(candidates, candidate) {
  if (!candidate) return;
  candidates.splice(0, candidates.length, candidate);
}

function keepOnlyTopCandidate(candidates) {
  keepOnlyCandidate(candidates, candidates[0]);
}

// 日期和普通集号共用作品偏好；手动确认优先，且不能跨作品兜底。
function findPreferredWork(globals, name, matchedKeyword, candidates) {
  const keys = [...new Set([name, matchedKeyword].filter(Boolean))];
  const manualKey = keys.find(key => globals.lastSelectMap.get(key)?.explicitBySeason?.default === true);
  for (const key of manualKey ? [manualKey] : keys) {
    const [animeId, source] = getPreferAnimeId(key);
    if (!animeId) continue;

    const matches = candidates.filter(candidate => {
      const animeMatches = String(getCandidateAnimeId(candidate)) === String(animeId) ||
        String(candidate?.anime?.bangumiId ?? "") === String(animeId);
      return animeMatches && (!source || String(getCandidateSource(candidate)) === String(source));
    });
    const explicit = globals.lastSelectMap.get(key)?.explicitBySeason?.default === true;
    if (explicit || matches.length) return { key, candidates: matches, explicit };
  }
  return null;
}

function findPreferredCandidate(episode, focus, candidates, preferredWork) {
  if (!preferredWork) return null;
  const preferredCandidates = candidates.filter(candidate => preferredWork.candidates.includes(candidate));
  if (!preferredCandidates.length) return null;

  const focusedCandidate = findFocusedEpisodeCandidate(focus, preferredCandidates);
  if (focusedCandidate) return focusedCandidate;

  const episodeCandidate = findRegularEpisodeCandidate(focus, preferredCandidates);
  if (episodeCandidate) return episodeCandidate;

  const titleOverlapCandidate = findTitleOverlapCandidate(episode, preferredCandidates, focus);
  if (titleOverlapCandidate) return titleOverlapCandidate;

  if (preferredWork.explicit || focus.episodeNo) {
    log("info", `[Fongmi][Prefer] skipped fallback by lastSelectMap: key=${preferredWork.key}`);
    return null;
  }
  return preferredCandidates[0];
}

function shouldUseFongmiAi(candidates) {
  if (candidates.length <= 1) return false;

  const top = candidates[0];
  const nextDifferentWork = candidates.find(candidate => !sameCandidateWork(top, candidate));

  if (!nextDifferentWork) {
    return top.score < FONGMI_AI_STRONG_SCORE;
  }

  const scoreGap = top.score - nextDifferentWork.score;
  return top.score < FONGMI_AI_STRONG_SCORE || scoreGap < FONGMI_AI_SAFE_SCORE_GAP;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCandidateTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripEpisodeFileMetadata(value) {
  return String(value || "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:[kmgt]i?b|[gm])\b/gi, " ")
    .replace(/\b\d\.\d(?:\.\d)?\s*(?:声道|channels?\b|ch\b)/gi, " ")
    .replace(/\b(?:aac|e-?ac-?3|ac-?3|dd(?:p|\+)?|dts(?:-hd)?|truehd)[\s._-]*\d\.\d(?:\.\d)?\b/gi, " ")
    .replace(/\b\d\.\d(?:\.\d)?\s*(?:aac|e-?ac-?3|ac-?3|dd(?:p|\+)?|dts(?:-hd)?|truehd)(?!\w)/gi, " ")
    .replace(FONGMI_FILE_METADATA_RE, " ")
    .replace(/\.(?:mp4|mkv|avi|rmvb|ts|flv|mov|m4v)\s*$/i, " ");
}

// 日期必须在标点清洗前提取，避免 03.15 被拆成两个普通集号。
export function extractFongmiEpisodeDate(value) {
  const text = stripEpisodeFileMetadata(stripEpisodeCollectionMetadata(value));
  const full = text.match(/(?:^|[^\d])((?:19|20)\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})(?!\d)/)
    || text.match(/(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/);
  const short = !full && text.match(/(?:^|[^\dA-Za-z.\-/年])(\d{1,2})[.\-/月](\d{1,2})(?:日|号)?(?!\d|[集话章回])/);
  if (!full && !short) return null;

  const year = full ? Number(full[1]) : null;
  const month = Number(full ? full[2] : short[1]);
  const day = Number(full ? full[3] : short[2]);
  const calendar = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return { year, month, day };
}

function datesMatch(target, date) {
  return Boolean(date && date.month === target.month && date.day === target.day &&
    (target.year === null || date.year === null || date.year === target.year));
}

function extractEpisodePartToken(value) {
  const match = String(value || "").match(/(?:[集期话日号]|\d)[\s_.\/|｜-]*(?:[（(【\[]\s*)?([上中下])(?=$|[\s_.\-:：,，。;；、）)】\]（(])/);
  return match ? match[1] : "";
}

function normalizeEpisodeTitleText(value) {
  return normalizeCandidateTitle(String(value || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[【（(][^】）)]*[】）)]/g, " ")
    .replace(/\.(?:mp4|mkv|avi|rmvb|ts|flv|mov|m4v)\b/gi, " ")
    .replace(FONGMI_FILE_METADATA_RE, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|g|m)\b/gi, " ")
    .replace(/20\d{6}/g, " ")
    .replace(/[_~.-]+/g, " ")
    .replace(/[《》"'“”‘’]+/g, " ")
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, " "));
}

function buildEpisodeTitleTokens(value) {
  const text = normalizeEpisodeTitleText(value);
  if (!text) return [];

  return [...new Set(text
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token =>
      token.length >= 2 &&
      !/^\d+$/.test(token) &&
      !/^第?\d+[集期话]?$/.test(token) &&
      !FONGMI_EPISODE_TITLE_STOP_TOKENS.has(token)))];
}

function scoreEpisodeTitleOverlap(episode, candidate) {
  const tokens = buildEpisodeTitleTokens(episode);
  if (!tokens.length) return 0;

  const candidateText = normalizeEpisodeTitleText(candidate?.episode?.episodeTitle || "");
  if (!candidateText) return 0;
  const compactCandidateText = candidateText.replace(/\s+/g, "");

  let score = 0;
  for (const token of tokens) {
    const compactToken = token.replace(/\s+/g, "");
    const conciseToken = compactToken.replace(FONGMI_EPISODE_TITLE_QUESTION_PREFIX_RE, "");
    const variants = [compactToken];
    if (conciseToken.length >= 4 && conciseToken !== compactToken) variants.push(conciseToken);
    const matchedVariant = variants.find(variant =>
      variant.length >= 4 && compactCandidateText.includes(variant));
    if (candidateText.includes(token) || matchedVariant) {
      const matchedLength = matchedVariant?.length || token.length;
      score += matchedLength * matchedLength;
    }
  }
  return score;
}

function findTitleOverlapCandidate(episode, candidates, focus) {
  let scopedCandidates = candidates;
  if (focus?.episodeNo) {
    scopedCandidates = candidates.filter(candidate =>
      String(extractFocusedEpisodeNo(candidate?.episode?.episodeTitle || "")) === String(focus.episodeNo));
    if (!scopedCandidates.length) return null;
  }

  const ranked = scopedCandidates
    .map(candidate => ({ candidate, score: scoreEpisodeTitleOverlap(episode, candidate) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < 16) return null;

  const top = ranked[0];
  const next = ranked[1];
  if (next && top.score === next.score) return null;

  log("info", `[Fongmi][Prefer] selected episode by title overlap: score=${top.score}, episode=${top.candidate.episode?.episodeTitle || ""}`);
  return top.candidate;
}

function buildFongmiAiFocus(episode) {
  return {
    episodeNo: extractEpisodeNoFromRawEpisode(episode),
    date: extractFongmiEpisodeDate(episode),
    partToken: extractEpisodePartToken(episode)
  };
}

// 作品、显式集号和上下集已由公共流程限定，这里只过滤日期冲突并判断日期是否足以直选。
function selectDateCandidate(episode, focus, candidates) {
  const oneWork = candidates.every(candidate => sameCandidateWork(candidates[0], candidate));
  const dates = new Map(candidates.map(candidate => [candidate, extractFongmiEpisodeDate(candidate.episode?.episodeTitle)]));
  const matches = candidates.filter(candidate => datesMatch(focus.date, dates.get(candidate)));
  const remaining = candidates.filter(candidate => {
    if (dates.get(candidate)) return matches.includes(candidate);
    if (!matches.length) return true;
    // 同一期的无日期版本留给 AI；不能把其他作品或其他期数混进来。
    const episodeNo = extractCandidateEpisodeNo(candidate);
    return episodeNo !== null && matches.some(match =>
      sameCandidateWork(candidate, match) && extractCandidateEpisodeNo(match) === episodeNo);
  });
  candidates.splice(0, candidates.length, ...remaining);

  if (/正片/.test(String(episode)) || FONGMI_SPECIAL_EPISODE_VERSION_RE.test(String(episode))) return null;
  const confirmedDate = matches.length === 1 && (focus.date.year === null ||
    dates.get(matches[0]).year !== null || focus.episodeNo !== null);
  let candidate = confirmedDate && remaining.length === 1 && oneWork ? matches[0] : null;
  // 明确期数已筛选且日期冲突已排除；唯一候选缺少日期时仍可按期数命中。
  if (!candidate && focus.episodeNo && remaining.length === 1 && oneWork) candidate = remaining[0];
  if (!candidate && !matches.length && oneWork) candidate = findTitleOverlapCandidate(episode, remaining, null);
  if (candidate && (!canSelectFongmiOrdinalCandidate(episode, candidate) ||
      FONGMI_SPECIAL_EPISODE_VERSION_RE.test(candidate.episode?.episodeTitle || "") ||
      (!focus.partToken && extractEpisodePartToken(candidate.episode?.episodeTitle)))) return null;
  return candidate;
}

function extractRegularEpisodeNo(title) {
  // “第20190315期”是日期，不是第 20190315 期。
  const text = String(title || "").replace(/第\s*((?:19|20)\d{6})\s*[集期话]/g,
    (match, digits) => extractFongmiEpisodeDate(digits) ? " " : match);
  const match = text.match(/第\s*([零〇一二三四五六七八九十百\d]+)\s*([集期话])/);
  if (!match) return null;

  const episodeNo = convertChineseNumber(match[1]);
  if (!Number.isInteger(episodeNo) || episodeNo <= 0 || episodeNo >= 10000) return null;
  return {
    value: String(episodeNo),
    suffix: match[2],
    text: match[0],
    index: match.index
  };
}

function buildRegularEpisodePattern(title, episodeNo, suffix) {
  const normalizedTitle = normalizeCandidateTitle(title);
  if (!normalizedTitle || FONGMI_AI_REGULAR_GROUP_UNSAFE_RE.test(normalizedTitle)) return "";

  const noPattern = escapeRegExp(String(parseInt(episodeNo, 10)));
  const paddedNoPattern = `0*${noPattern}`;
  const episodePrefixRe = new RegExp(`第\\s*${paddedNoPattern}\\s*${escapeRegExp(suffix)}`, "g");
  const standaloneNoRe = new RegExp(`(^|[^\\d])0*${noPattern}(?=$|[^\\d])`, "g");

  return normalizedTitle
    .replace(episodePrefixRe, `第{n}${suffix}`)
    .replace(standaloneNoRe, (match, prefix) => `${prefix}{n}`);
}

function extractFocusedEpisodeNo(title) {
  const explicitEpisode = extractExplicitEpisode(title);
  if (explicitEpisode) return explicitEpisode.value;
  if (extractFongmiEpisodeDate(title)) return null;

  const text = normalizeCandidateTitle(title);
  const match = text.match(/(?:^|[_\s-])0*(\d{1,4})(?:\D*)$/);
  if (!match) return null;

  const episodeNo = parseInt(match[1], 10);
  if (!Number.isInteger(episodeNo) || episodeNo <= 0) return null;
  return String(episodeNo);
}

function buildRegularGroupPayload(group) {
  const templates = new Map();

  for (const candidate of group.candidates) {
    const title = candidate.episode?.episodeTitle || "";
    const episodeNo = extractRegularEpisodeNo(title);
    const candidateId = getCandidateId(candidate);
    if (!episodeNo || candidateId === null) continue;

    const pattern = buildRegularEpisodePattern(title, episodeNo.value, episodeNo.suffix);
    if (!pattern || !pattern.includes("{n}")) continue;

    if (!templates.has(pattern)) {
      templates.set(pattern, {
        pattern,
        sampleTitle: normalizeCandidateTitle(title),
        episodes: [],
        episodeNos: new Set()
      });
    }

    const template = templates.get(pattern);
    if (template.episodeNos.has(episodeNo.value)) continue;
    template.episodeNos.add(episodeNo.value);
    template.episodes.push([String(candidateId), episodeNo.value]);
  }

  const minCoverage = Math.ceil(group.candidates.length * FONGMI_AI_REGULAR_GROUP_COVERAGE);
  const minSize = Math.max(FONGMI_AI_REGULAR_GROUP_MIN_SIZE, minCoverage);
  const best = [...templates.values()].sort((a, b) => b.episodes.length - a.episodes.length)[0];
  if (!best || best.episodes.length < minSize) return null;

  return {
    sampleTitle: best.sampleTitle,
    pattern: best.pattern,
    episodes: best.episodes
  };
}

function buildCandidateGroups(candidates) {
  const groups = [];
  const groupMap = new Map();

  for (const candidate of candidates) {
    const animeId = getCandidateAnimeId(candidate);
    const source = getCandidateSource(candidate);
    const animeTitle = candidate?.anime?.animeTitle || "";
    const groupId = `${source || "unknown"}:${animeId ?? animeTitle}`;

    if (!groupMap.has(groupId)) {
      const group = {
        groupId,
        animeId,
        source,
        animeTitle,
        aliases: candidate?.anime?.aliases || [],
        type: candidate?.anime?.type || "",
        typeDescription: candidate?.anime?.typeDescription || "",
        startDate: candidate?.anime?.startDate || "",
        candidates: []
      };
      groupMap.set(groupId, group);
      groups.push(group);
    }

    groupMap.get(groupId).candidates.push(candidate);
  }

  return groups;
}

function buildGroupPayload(group, { includeEpisodes = true } = {}) {
  const payload = {
    groupId: group.groupId,
    animeTitle: group.animeTitle,
    source: group.source || "",
    type: group.type || "",
    typeDescription: group.typeDescription || "",
    startDate: group.startDate || "",
    count: group.candidates.length,
    topScore: group.candidates[0]?.score ?? 0
  };

  if (group.aliases?.length) payload.aliases = group.aliases.slice(0, 5);
  if (!includeEpisodes) {
    const firstTitle = group.candidates[0]?.episode?.episodeTitle || "";
    if (firstTitle) payload.sampleTitle = normalizeCandidateTitle(firstTitle);
    return payload;
  }

  const regularPayload = buildRegularGroupPayload(group);
  if (regularPayload) {
    return {
      ...payload,
      kind: "regular",
      ...regularPayload
    };
  }

  return {
    ...payload,
    kind: "episodes",
    episodes: group.candidates
      .map(candidate => {
        const candidateId = getCandidateId(candidate);
        const title = normalizeCandidateTitle(candidate?.episode?.episodeTitle || "");
        if (candidateId === null || !title) return null;
        return [String(candidateId), title];
      })
      .filter(Boolean)
  };
}

function buildFocusedGroupPayload(group, focus) {
  const payload = buildGroupPayload(group);
  const targetEpisodeNo = focus?.episodeNo;
  if (!targetEpisodeNo || !payload) return payload;

  if (payload.kind === "regular" && Array.isArray(payload.episodes)) {
    const focusedEpisodes = payload.episodes.filter(([, episodeNo]) => String(episodeNo) === String(targetEpisodeNo));
    if (focusedEpisodes.length) {
      return {
        ...payload,
        episodes: focusedEpisodes
      };
    }
  }

  if (payload.kind === "episodes" && Array.isArray(payload.episodes)) {
    let focusedEpisodes = payload.episodes.filter(([, title]) => String(extractFocusedEpisodeNo(title)) === String(targetEpisodeNo));
    if (focus?.partToken) {
      const partFocused = focusedEpisodes.filter(([, title]) => extractEpisodePartToken(title) === focus.partToken);
      if (partFocused.length) focusedEpisodes = partFocused;
    }
    if (focusedEpisodes.length) {
      return {
        ...payload,
        episodes: focusedEpisodes
      };
    }
  }

  return payload;
}

function findCandidateByAiResponse(parsedResponse, candidates) {
  const rawCandidateId = parsedResponse?.candidateId ?? parsedResponse?.id ?? parsedResponse?.episodeId;
  if (rawCandidateId !== null && rawCandidateId !== undefined) {
    const selected = candidates.find(candidate => String(getCandidateId(candidate)) === String(rawCandidateId));
    if (selected) return selected;
    log("warn", `[Fongmi][AI] Invalid candidateId: ${rawCandidateId}`);
    return null;
  }

  const rawEpisodeTitle = parsedResponse?.episodeTitle ?? parsedResponse?.title;
  if (rawEpisodeTitle) {
    const selected = candidates.find(candidate => candidate?.episode?.episodeTitle === rawEpisodeTitle);
    if (selected) return selected;
    log("warn", `[Fongmi][AI] Invalid episodeTitle: ${rawEpisodeTitle}`);
  }

  return null;
}

async function persistLastSelectMap(globals) {
  if (globals.localCacheValid) {
    writeCacheToFile("lastSelectMap", JSON.stringify(Object.fromEntries(globals.lastSelectMap)));
  }
  if (globals.redisValid) {
    await setRedisKey("lastSelectMap", globals.lastSelectMap);
  }
  if (globals.localRedisValid) {
    await setLocalRedisKey("lastSelectMap", globals.lastSelectMap);
  }
}

function setPreferForKey(globals, key, animeId, source) {
  const value = globals.lastSelectMap.get(key);
  if (!value?.animeIds?.some(id => String(id) === String(animeId))) return false;
  if (value.explicitBySeason?.default === true) return false;

  value.preferBySeason = value.preferBySeason || {};
  value.sourceBySeason = value.sourceBySeason || {};
  value.preferBySeason.default = animeId;
  value.sourceBySeason.default = source;
  globals.lastSelectMap.set(key, value);
  return true;
}

function rememberPreferAnimeId(globals, name, matchedKeyword, animeId, source) {
  const keys = [...new Set([matchedKeyword, name].filter(Boolean))];
  for (const key of keys) {
    if (setPreferForKey(globals, key, animeId, source)) return key;
  }

  return setPreferByAnimeId(animeId, source);
}

async function rememberFongmiAiCandidate(globals, name, matchedKeyword, candidate) {
  const animeId = getCandidateAnimeId(candidate);
  const source = getCandidateSource(candidate);
  if (!animeId) return;

  const preferenceKeys = [...new Set([name, matchedKeyword].filter(Boolean))];
  const hasExplicitManualPreference = preferenceKeys.some(key =>
    globals.lastSelectMap.get(key)?.explicitBySeason?.default === true
  );
  if (hasExplicitManualPreference) {
    log("info", `[Fongmi][AI] skipped remembering candidate because manual preference is explicit: keys=${preferenceKeys.join("|")}`);
    return;
  }

  const updatedKey = rememberPreferAnimeId(globals, name, matchedKeyword, animeId, source);
  if (!updatedKey) {
    log("warn", `[Fongmi][AI] selected animeId=${animeId}, but no lastSelectMap entry was updated`);
    return;
  }

  try {
    await persistLastSelectMap(globals);
    log("info", `[Fongmi][AI] remembered preference: key=${updatedKey}, animeId=${animeId}, source=${source || ""}`);
  } catch (error) {
    log("error", `[Fongmi][AI] failed to persist preference: ${error.message}`);
  }
}

async function askFongmiAi(globals, payload, stage = "selectCandidate") {
  const options = buildFongmiAiOptions(globals);
  const messages = [
    { role: "system", content: FONGMI_AI_MATCH_PROMPT },
    { role: "user", content: JSON.stringify(payload) }
  ];
  const request = buildFongmiAiChatRequest(globals, messages, options, payload);

  const response = await httpPost(request.url, JSON.stringify(request.body), {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${globals.aiApiKey}`
    },
    timeout: 60000
  });
  const responseData = response.data;
  if (responseData?.error) {
    throw new Error(`AI API error ${response.status}: ${responseData.error.message}`);
  }
  log("info", `[Fongmi][AI] raw response summary (${stage}): ${JSON.stringify(summarizeFongmiAiResponse(responseData))}`);
  const aiResponse = responseData?.choices?.[0]?.message?.content || "";
  log("info", `[Fongmi][AI] match response: ${aiResponse}`);
  return parseFongmiAiJson(aiResponse);
}

export async function selectFongmiCandidateByAi(globals, name, episode, candidates, matchedKeyword = name) {
  if (!candidates.length) return null;

  const matchingEpisode = stripEpisodeCollectionMetadata(episode);
  const focus = buildFongmiAiFocus(matchingEpisode);
  const preferredWork = findPreferredWork(globals, name, matchedKeyword, candidates);
  const manualWork = preferredWork?.explicit === true;
  if (manualWork || (focus.date && preferredWork)) {
    candidates.splice(0, candidates.length, ...preferredWork.candidates);
  }
  if (narrowFocusedCandidates(focus, candidates, manualWork)) return null;
  if (!candidates.length) return null;

  const preferredCandidate = focus.date
    ? selectDateCandidate(matchingEpisode, focus, candidates)
    : findPreferredCandidate(matchingEpisode, focus, candidates, findPreferredWork(globals, name, matchedKeyword, candidates));
  if (!candidates.length) return null;
  if (preferredCandidate) {
    keepOnlyCandidate(candidates, preferredCandidate);
    return preferredCandidate;
  }

  const candidatesFromSameWork = candidates.every(candidate => sameCandidateWork(candidates[0], candidate));
  if (!focus.date && candidatesFromSameWork) {
    const titleOverlapCandidate = findTitleOverlapCandidate(matchingEpisode, candidates, focus);
    if (titleOverlapCandidate) {
      keepOnlyCandidate(candidates, titleOverlapCandidate);
      return titleOverlapCandidate;
    }
  }

  if (!globals.aiValid || !globals.aiApiKey) {
    if (manualWork || focus.date) candidates.splice(0, candidates.length);
    else keepOnlyTopCandidate(candidates);
    return null;
  }
  if (!focus.date && !manualWork && !shouldUseFongmiAi(candidates)) {
    log("info", `[Fongmi][AI] skipped: local score is confident for ${candidates[0].anime?.animeTitle || ""}`);
    keepOnlyTopCandidate(candidates);
    return null;
  }

  const groups = buildCandidateGroups(candidates);
  // 日期候选已过滤；保留其中的无日期版本，避免二次聚焦时丢失。
  const aiFocus = focus.date ? null : focus;
  const aiName = globals.lastSelectMap.get(name)?.fongmiCorrectedTitle || name;

  try {
    let aiCandidates = candidates;
    let payload;

    if (candidates.length <= FONGMI_AI_COMPACT_LIMIT) {
      payload = {
        mode: "selectCandidate",
        name: aiName,
        episodeRaw: episode,
        groups: groups.map(group => buildFocusedGroupPayload(group, aiFocus))
      };
    } else {
      if (groups.length === 1) {
        aiCandidates = groups[0].candidates;
        payload = {
          mode: "selectCandidate",
          name: aiName,
          episodeRaw: episode,
          groups: [buildFocusedGroupPayload(groups[0], aiFocus)]
        };
      } else {
        const groupResponse = await askFongmiAi(globals, {
          mode: "selectGroup",
          name: aiName,
          episodeRaw: episode,
          groups: groups.map(group => buildGroupPayload(group, { includeEpisodes: false }))
        }, "selectGroup");
        const groupId = groupResponse?.groupId;
        const selectedGroup = groups.find(group => String(group.groupId) === String(groupId));
        if (!selectedGroup) {
          if (groupId !== null && groupId !== undefined) {
            log("warn", `[Fongmi][AI] Invalid groupId: ${groupId}`);
          }
          candidates.splice(0, candidates.length);
          return null;
        }

        aiCandidates = selectedGroup.candidates;
        payload = {
          mode: "selectCandidate",
          name: aiName,
          episodeRaw: episode,
          groups: [buildFocusedGroupPayload(selectedGroup, aiFocus)]
        };
      }
    }

    const parsedResponse = await askFongmiAi(globals, payload, payload.mode);
    const selectedCandidate = findCandidateByAiResponse(parsedResponse, aiCandidates);
    if (!selectedCandidate) {
      candidates.splice(0, candidates.length);
      log("info", "[Fongmi][AI] no matching candidate; automatic selection stopped");
      return null;
    }

    await rememberFongmiAiCandidate(globals, name, matchedKeyword, selectedCandidate);
    keepOnlyCandidate(candidates, selectedCandidate);
    return selectedCandidate;
  } catch (error) {
    log("error", `[Fongmi][AI] matching failed: ${error.message}`);
    candidates.splice(0, candidates.length);
    return null;
  }
}
