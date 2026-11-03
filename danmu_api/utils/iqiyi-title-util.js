// 爱奇艺分集标题兼容层：合并接口返回的标题与副标题，避免重复文案。

function normalizeTitlePart(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * 合并爱奇艺分集标题字段。
 *
 * 爱奇艺有时会同时把同一段宣传文案放进 short_display_name 的末尾和
 * subtitle 中。移除重复的期数前缀和重叠文案，不改变期数、分段标记或
 * 其它不重复的副标题。
 */
export function mergeIqiyiEpisodeTitle(baseValue, subtitleValue, fallback = '未知分集') {
  const base = normalizeTitlePart(baseValue);
  let subtitle = normalizeTitlePart(subtitleValue);
  if (!base) return subtitle || fallback;
  if (!subtitle || base.includes(subtitle)) return base;

  // 副标题可能带分段编号且紧接文案；只移除同一期、同一上/中/下及分段的前缀。
  // 整期副标题没有分段编号时，仍保留主标题的分段编号。
  const baseEpisode = base.match(/^第\s*(\d+)\s*期\s*([上中下]?)(?:\s*[（(]\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[）)])?/);
  const subtitleEpisode = subtitle.match(/^第\s*(\d+)\s*期\s*([上中下]?)(?:\s*[（(]\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[）)]|(?=\s|$))/);
  if (baseEpisode && subtitleEpisode && Number(baseEpisode[1]) === Number(subtitleEpisode[1]) &&
      baseEpisode[2] === subtitleEpisode[2] &&
      (!subtitleEpisode[3] || baseEpisode[3] === subtitleEpisode[3])) {
    subtitle = subtitle.slice(subtitleEpisode[0].length).trim();
    if (!subtitle || base.includes(subtitle)) return base;
    const baseText = base.slice(baseEpisode[0].length).trim();
    // 主标题文案已完整包含在副标题中时，直接保留更完整的副标题。
    if (!baseText || subtitle.includes(baseText)) return `${baseEpisode[0].trim()} ${subtitle}`;
  }

  const maxOverlap = Math.min(base.length, subtitle.length);
  // 两个字符以下的重叠过于常见，避免误删正常标题连接词。
  for (let length = maxOverlap; length >= 2; length -= 1) {
    if (base.slice(-length) !== subtitle.slice(0, length)) continue;
    const remainder = subtitle.slice(length).trim();
    return remainder ? `${base} ${remainder}` : base;
  }
  return `${base} ${subtitle}`;
}

export function buildIqiyiEpisodeTitle(epData = {}) {
  return mergeIqiyiEpisodeTitle(
    epData.short_display_name || epData.title,
    epData.subtitle
  );
}

export function hasIqiyiEpisodeNumber(title) {
  return /第\s*\d+\s*[集期]/.test(String(title || ''));
}
