// 爱奇艺综艺兼容层：仅供 FongMi 的完整期数文件使用，不扩展通用合并协议。
export const IQIYI_CONCAT_PREFIX = 'iqiyi-concat:';
const PART_PATTERN = /第\s*(\d{1,4})\s*期\s*([上中下])\s*[（(]\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[）)]/;
const SPLIT_RE = new RegExp(`^(?:【[^】]+】\\s*)?${PART_PATTERN.source}(?=\\s|$|[：:，,。.!！?？、])`);
const SPECIAL_RE = /纯享|加更|花絮|未播|番外|预告|先导|会员版/;

function partNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '一二三四五六七八九';
  if (value === '十') return 10;
  if (value.length === 1) return digits.indexOf(value) + 1;
  const match = value.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/);
  return match ? (match[1] ? digits.indexOf(match[1]) + 1 : 1) * 10 + (match[2] ? digits.indexOf(match[2]) + 1 : 0) : 0;
}

function isIqiyiUrl(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && url.protocol === 'https:' &&
      /^(?:www\.)?iqiyi\.com$/.test(url.hostname) && !url.port &&
      !url.username && !url.password && /^\/v_[a-z0-9]+\.html$/i.test(url.pathname);
  } catch { return false; }
}

export function decodeIqiyiConcatPayload(value) {
  if (!String(value).startsWith(IQIYI_CONCAT_PREFIX)) throw new Error('Invalid iqiyi concat address');
  const payload = JSON.parse(decodeURIComponent(value.slice(IQIYI_CONCAT_PREFIX.length)));
  // 保持此前已生成的数组地址可用，新地址额外携带候选 ID。
  const urls = Array.isArray(payload) ? payload : payload?.urls;
  if (!Array.isArray(urls) || urls.length < 2 || urls.length > 99 || !urls.every(isIqiyiUrl) || new Set(urls).size !== urls.length) {
    throw new Error('Invalid iqiyi concat videos');
  }
  const episodeId = Array.isArray(payload) ? null : payload.episodeId;
  if (episodeId != null && !((typeof episodeId === 'number' || typeof episodeId === 'string') &&
    /^\d+$/.test(String(episodeId)) && Number.isSafeInteger(Number(episodeId)) && Number(episodeId) > 0)) {
    throw new Error('Invalid iqiyi concat episode ID');
  }
  return { urls, episodeId };
}

export function decodeIqiyiConcat(value) {
  return decodeIqiyiConcatPayload(value).urls;
}

export function prepareIqiyiFongmiEpisodes(episodes, rawEpisode = '') {
  // 在通用去重之前移除无效占位字段，否则所有“第0集”会被当作同一集。
  const normalized = episodes.map(episode => ({
    ...episode,
    episodeTitle: String(episode.episodeTitle || '').replace(
      /^((?:【[^】]+】\s*)?)第\s*0+\s*集\s*(?=第\s*\d+\s*期)/, '$1')
  }));
  // 明确播放某一段时，必须先精确筛选；通用匹配只识别上中下，不识别括号内的编号。
  const requested = String(rawEpisode).match(PART_PATTERN);
  if (requested) return normalized.filter(episode => {
    const match = episode.episodeTitle.match(SPLIT_RE);
    return match && Number(match[1]) === Number(requested[1]) && match[2] === requested[2] &&
      partNumber(match[3]) > 0 && partNumber(match[3]) === partNumber(requested[3]);
  });

  const groups = new Map();
  for (const episode of normalized) {
    const match = episode.episodeTitle.match(SPLIT_RE);
    if (!match || SPECIAL_RE.test(episode.episodeTitle) || !isIqiyiUrl(episode.url)) continue;
    const dateMatch = episode.episodeTitle.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    const date = dateMatch ? `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}` : '';
    const key = `${Number(match[1])}:${match[2]}:${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ episode, part: partNumber(match[3]) });
  }

  const replacements = new Map();
  const consumed = new Set();
  for (const parts of groups.values()) {
    if (parts.length < 2 || parts.length > 99) continue;
    parts.sort((a, b) => a.part - b.part);
    // 从一开始连续、无重复才合并；缺（二）时不能把（一）（三）直接拼在一起。
    if (parts.some((part, index) => part.part !== index + 1)) continue;
    const urls = parts.map(part => part.episode.url);
    if (new Set(urls).size !== urls.length) continue;
    const first = parts[0];
    const address = IQIYI_CONCAT_PREFIX + encodeURIComponent(JSON.stringify({ urls, episodeId: first.episode.episodeId }));
    const combined = {
      ...first.episode,
      episodeTitle: first.episode.episodeTitle.replace(SPLIT_RE, matched => matched.replace(/[（(]\s*(?:一|0?1)\s*[）)]$/, '')),
      iqiyiConcatUrl: address
    };
    // 放在原列表中较早的位置，不改变其它分集的排序。
    const earlier = parts.reduce((a, b) => normalized.indexOf(a.episode) < normalized.indexOf(b.episode) ? a : b).episode;
    replacements.set(earlier, combined);
    for (const part of parts) consumed.add(part.episode);
  }
  return normalized.flatMap(episode => replacements.has(episode)
    ? [replacements.get(episode)] : consumed.has(episode) ? [] : [episode]);
}
