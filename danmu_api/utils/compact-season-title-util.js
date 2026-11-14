// Only compare compact sequel numbers within the same base title. Keep unnumbered
// titles and longer numeric work names available to the existing fallback logic.
function stripTitleMetadata(value, titleNoiseFilter) {
  let title = (titleNoiseFilter ? value.replace(titleNoiseFilter, '') : value).trim();
  const suffix = /(?:\s*\bfrom\s+\S+|【[^】]*】|[（(]\s*(?:(?:19|20)\d{2}|[上中下])\s*[）)])\s*$/i;
  while (true) {
    const stripped = title.replace(suffix, '')
      .replace(/(\d(?:\s*[季期部])?|第\s*[一二三四五六七八九十百千万]+\s*[季期部])\s*[上中下]\s*$/, '$1').trim();
    if (stripped === title) return title;
    title = stripped;
  }
}

function parseNumberedTitle(title, getExplicitSeason) {
  const explicit = title.match(/^(.*?)(第\s*[0-9一二三四五六七八九十百千万]+\s*[季期部]|(?:Season|S|Part)\s*\d+)$/i);
  if (explicit) {
    return { base: explicit[1], season: getExplicitSeason(explicit[2]), explicit: true };
  }
  const compact = title.match(/^(.*\D)(\d{1,2})$/);
  const season = compact ? Number(compact[2]) : 0;
  return season > 0 ? { base: compact[1], season, explicit: false } : null;
}

// Reuse the caller's parsers without importing common-util back into this helper.
export function hasConflictingCompactSeason(title, query, querySeason, normalizeTitle, getExplicitSeason, titleNoiseFilter = null) {
  const candidate = parseNumberedTitle(stripTitleMetadata(title, titleNoiseFilter), getExplicitSeason);
  if (!candidate) return false;

  const cleanQuery = stripTitleMetadata(query, titleNoiseFilter);
  const resolvedSeason = querySeason !== null ? querySeason : getExplicitSeason(cleanQuery);
  let requested = parseNumberedTitle(cleanQuery, getExplicitSeason);
  if (resolvedSeason !== null) {
    if (!requested) requested = { base: cleanQuery, season: resolvedSeason };
    else if (requested.explicit) requested.season = resolvedSeason;
  }
  if (!requested || candidate.season === requested.season) return false;

  const base = normalizeTitle(requested.base).toLowerCase();
  return base !== '' && normalizeTitle(candidate.base).toLowerCase() === base;
}
