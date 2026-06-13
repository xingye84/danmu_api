function isDuplicateBoundary(value) {
  return !value || /^[\s,，。:：;；!！?？、-]/.test(value);
}

function normalizeDisplaySpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function collapseLeadingRepeatedText(text) {
  const value = normalizeDisplaySpaces(text);
  if (value.length < 8) return value;

  for (let length = Math.floor(value.length / 2); length >= 4; length--) {
    const fragment = value.slice(0, length).trimEnd();
    const rest = value.slice(length).trimStart();
    if (fragment.length < 4 || rest.length < fragment.length) continue;
    if (!rest.startsWith(fragment)) continue;

    const boundary = rest.slice(fragment.length, fragment.length + 1);
    if (isDuplicateBoundary(boundary)) return rest;
  }

  return value;
}

export function normalizeFongmiEpisodeDisplayTitle(title) {
  const rawTitle = normalizeDisplaySpaces(title);
  if (!rawTitle) return "";

  const sourceMatch = rawTitle.match(/^(【[^】]+】\s*)/);
  const source = sourceMatch ? sourceMatch[1] : "";
  let text = source ? rawTitle.slice(source.length).trim() : rawTitle;

  const episodeMatch = text.match(/^((?:第\s*[\d零一二三四五六七八九十百千万〇两]+\s*[集期话章回段篇]|[Ee][Pp]?\.?\s*\d+|[Pp]\d+)\s+)(.+)$/);
  if (episodeMatch) {
    text = episodeMatch[1] + collapseLeadingRepeatedText(episodeMatch[2]);
  } else {
    text = collapseLeadingRepeatedText(text);
  }

  return `${source}${text}`.trim();
}

export function normalizeFongmiDetailStoreEpisodeTitles(detailStore) {
  if (!(detailStore instanceof Map)) return;

  for (const [key, anime] of detailStore.entries()) {
    if (!anime || !Array.isArray(anime.links)) continue;

    let changed = false;
    const links = anime.links.map(link => {
      if (!link?.title) return link;
      const title = normalizeFongmiEpisodeDisplayTitle(link.title);
      if (title === link.title) return link;
      changed = true;
      return { ...link, title };
    });

    if (changed) {
      detailStore.set(key, { ...anime, links });
    }
  }
}
