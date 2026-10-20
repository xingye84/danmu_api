import assert from 'node:assert/strict';
import test from 'node:test';
import { Globals } from '../../configs/globals.js';
import { prepareIqiyiFongmiEpisodes, decodeIqiyiConcat, IQIYI_CONCAT_PREFIX } from '../../utils/iqiyi-concat-util.js';
import { getIqiyiConcatComment } from '../../apis/clients/iqiyi-concat-api.js';
import { getFongmiDanmaku } from '../../apis/clients/fongmi-api.js';
import { getBangumi, getCommentByUrl, filterSameEpisodeTitle } from '../../apis/dandan-api.js';
import { getManualBangumi } from '../../apis/iqiyi-manual-bangumi-api.js';
import { getCommentCache, setSearchCache } from '../../utils/cache-util.js';
import { getSourceByKey } from '../../sources/registry.js';
import { handleFongmiManualCorrection } from '../../apis/clients/fongmi-manual-correction.js';
import { parseOffsetRules } from '../../utils/offset-util.js';
import IqiyiSource from '../../sources/iqiyi.js';
import { handleRequest } from '../../worker.js';

const FIRST = 'https://www.iqiyi.com/v_21ue20a528s.html';
const SECOND = 'https://www.iqiyi.com/v_18jtm4wm8uk.html';
const RAW = '[1.63GB] [S02] 0610第03期上.mp4';
const addressFor = urls => IQIYI_CONCAT_PREFIX + encodeURIComponent(JSON.stringify(urls));
const ADDRESS = addressFor([FIRST, SECOND]);
const pair = (number = 3, label = '上') => [
  { episodeId: 40270, episodeTitle: `【qiyi】 第0集 第${number}期${label}(一) Baby李晨穿越三国成夫妻`, url: FIRST },
  { episodeId: 40271, episodeTitle: `【qiyi】 第0集 第${number}期${label}(二) 沙溢被刘耀文洗脑`, url: SECOND }
];
const fourParts = () => ['一', '二', '三', '四'].map((part, index) => ({
  episodeId: 50270 + index,
  episodeTitle: `【qiyi】 第0集 第3期上（${part}） 正片`,
  url: `https://www.iqiyi.com/v_part${index + 1}.html`
}));

function resetConfig() {
  Globals.init({ LOG_LEVEL: 'error' });
  const globals = Globals.getConfig();
  globals.aiValid = false;
  globals.aiApiKey = '';
  globals.localCacheValid = globals.redisValid = globals.localRedisValid = false;
  globals.lastSelectMap.clear();
  globals.searchCache.clear();
  globals.favoriteCache.clear();
  globals.commentCache.clear();
  globals.commentCacheMinCount = 0;
  globals.commentCacheMinutes = 60;
  globals.animes = [];
  globals.sourceOrderArr = ['iqiyi'];
  globals.enableAnimeEpisodeFilter = false;
  globals.groupMinute = 0;
  globals.danmuOffsetRules = [];
  return globals;
}

test('iqiyi normalizes the reported zero placeholder before dedup and joins parts in playback order', () => {
  resetConfig();
  const original = [...pair().reverse(), ...pair(4)];
  const before = structuredClone(original);
  const prepared = prepareIqiyiFongmiEpisodes(original, RAW);
  assert.equal(prepared.length, 2);
  assert.equal(filterSameEpisodeTitle(prepared).length, 2);
  assert.equal(prepared[0].episodeId, 40270);
  assert.match(prepared[0].episodeTitle, /^【qiyi】 第3期上 /);
  assert.deepEqual(decodeIqiyiConcat(prepared[0].iqiyiConcatUrl), [FIRST, SECOND]);
  assert.match(prepared[1].episodeTitle, /第4期上/);
  assert.deepEqual(original, before, 'cached source details must not be mutated');
});

test('iqiyi keeps upper/lower and distinct dates separate, and accepts numeric full-width parts', () => {
  const upper = pair(13).map(e => ({ ...e, episodeTitle: e.episodeTitle.replace('(一)', '（1）').replace('(二)', '（2）') }));
  assert.equal(prepareIqiyiFongmiEpisodes([...upper, ...pair(13, '下')]).length, 2);
  const dates = pair().map((e, i) => ({ ...e, episodeTitle: `${e.episodeTitle} 2022-06-${10 + i}` }));
  assert.equal(prepareIqiyiFongmiEpisodes(dates).length, 2);
});

test('iqiyi refuses incomplete, ambiguous, special or invalid pairs', () => {
  const fixtures = [
    pair().slice(0, 1),
    [...pair(), { ...pair()[0], url: 'https://www.iqiyi.com/v_extra.html' }],
    pair().map(e => ({ ...e, episodeTitle: e.episodeTitle.replace('(二)', '(一)') })),
    pair().map(e => ({ ...e, episodeTitle: `${e.episodeTitle} 纯享` })),
    pair().map(e => ({ ...e, url: FIRST })),
    pair().map(e => ({ ...e, url: 'https://other.invalid/v_123.html' }))
  ];
  for (const fixture of fixtures) {
    const result = prepareIqiyiFongmiEpisodes(fixture, RAW);
    assert.equal(result.length, fixture.length);
    assert.ok(result.every(e => !e.iqiyiConcatUrl));
  }
  for (const suffix of ['(一)', '（二）', '(1)', '（2）']) {
    const result = prepareIqiyiFongmiEpisodes(pair(), `第03期上${suffix}.mp4`);
    assert.equal(result.length, 1);
    assert.equal(result[0].episodeId, /[二2]/.test(suffix) ? 40271 : 40270);
    assert.ok(result.every(e => !e.iqiyiConcatUrl));
  }
});

test('iqiyi private address rejects malformed or foreign video URLs', () => {
  assert.deepEqual(decodeIqiyiConcat(ADDRESS), [FIRST, SECOND]);
  for (const value of [
    'https://example.com', IQIYI_CONCAT_PREFIX + '%', addressFor([FIRST]),
    addressFor([FIRST, FIRST]), addressFor([FIRST, 'https://evil.invalid/v_123.html']),
    addressFor([FIRST, 'https://www.iqiyi.com.evil.invalid/v_123.html']),
    addressFor([FIRST, 'https://user@www.iqiyi.com/v_123.html']),
    addressFor([FIRST, 'https://www.iqiyi.com/other']),
    addressFor({ urls: [FIRST, SECOND], episodeId: {} })
  ]) assert.throws(() => decodeIqiyiConcat(value));
});

test('iqiyi concat shifts by true duration, returns total duration, and caches combined XML', async () => {
  resetConfig();
  const calls = [];
  const source = {
    async getEpisodeDanmuSegments(url) { calls.push(['segments', url]); return { duration: url === FIRST ? 100.5 : 60, segmentList: [{ url }] }; },
    async getEpisodeSegmentDanmu({ url }, options) { assert.equal(options, undefined); calls.push(['comments', url]); return [{ timepoint: url === FIRST ? 1 : 2, ct: 1, content: url === FIRST ? 'first' : 'second' }]; },
    formatComments: raw => raw
  };
  const response = await getIqiyiConcatComment(ADDRESS, source, 'json', false, true);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.videoDuration, 160.5);
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [1, 102.5]);
  assert.deepEqual(data.comments.map(c => c.m), ['first', 'second']);
  assert.equal(calls.length, 4);
  const xml = await (await getIqiyiConcatComment(ADDRESS, source, 'xml', false, false)).text();
  assert.match(xml, /102\.50?,/);
  assert.match(xml, /second/);
  assert.equal(calls.length, 4, 'XML cache hit must not refetch');
});

test('iqiyi concat returns available content without guessing unknown duration', async () => {
  resetConfig();
  let fetched = false;
  const source = {
    async getEpisodeDanmuSegments(url) { return { duration: url === FIRST ? 0 : 60, segmentList: [{ url }] }; },
    async getEpisodeSegmentDanmu() { fetched = true; return []; }
  };
  const response = await getIqiyiConcatComment(ADDRESS, source, 'json', false, true);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).comments, []);
  assert.equal(fetched, false);
  assert.equal(getCommentCache(ADDRESS), null);
  assert.equal((await getIqiyiConcatComment(ADDRESS, source, 'xml', true, false)).status, 400);
  assert.equal((await getIqiyiConcatComment('iqiyi-concat:bad', source, 'xml', false, false)).status, 400);
});

test('reported manual preference produces a single XML URL and public comment dispatch decodes it', async t => {
  const globals = resetConfig();
  const anime = { animeId: 8256680, bangumiId: '249m6jnptgg', animeTitle: '萌探探探案第2季(2022)【综艺】from iqiyi', source: 'iqiyi' };
  const originalName = '萌探探探案 1~2 真人秀';
  globals.lastSelectMap.set(originalName, {
    animeIds: [anime.animeId], preferBySeason: { default: String(anime.animeId) },
    sourceBySeason: { default: 'iqiyi' }, explicitBySeason: { default: true }, fongmiCorrectedTitle: '萌探探探案'
  });
  const details = { ...anime, links: [...pair(2), ...pair()].map(e => ({ id: e.episodeId, title: e.episodeTitle, url: e.url })) };
  globals.animes = [details];
  setSearchCache('萌探探探案::fongmi-source:iqiyi', [anime], new Map([[anime.bangumiId, details]]));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must use cached search'); });
  const url = new URL('https://test.invalid/api/v2/fongmi/danmaku');
  url.searchParams.set('name', originalName);
  url.searchParams.set('episode', RAW);
  const items = await (await getFongmiDanmaku(url, new Request(url), 'iqiyi-test')).json();
  assert.equal(items.length, 1);
  assert.match(items[0].name, /第3期上/);
  const commentUrl = new URL(items[0].url);
  assert.equal(commentUrl.pathname, '/api/v2/comment');
  assert.equal(commentUrl.searchParams.get('format'), 'xml');
  assert.deepEqual(decodeIqiyiConcat(commentUrl.searchParams.get('url')), [FIRST, SECOND]);
  const source = getSourceByKey('iqiyi');
  t.mock.method(source, 'getEpisodeDanmuSegments', async target => ({ duration: 100, segmentList: [{ url: target }] }));
  t.mock.method(source, 'getEpisodeSegmentDanmu', async ({ url: target }) => [{ showTime: '2', color: 'ffffff', content: target === FIRST ? 'first' : 'second' }]);
  const response = await getCommentByUrl(commentUrl.searchParams.get('url'), 'xml', false);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /102\.00?,/);
});

test('non-iqiyi FongMi candidates retain their original titles and comment route', async t => {
  const globals = resetConfig();
  globals.sourceOrderArr = ['youku'];
  const anime = { animeId: 777, bangumiId: 'youku-test', animeTitle: '测试综艺【综艺】from youku', source: 'youku' };
  const details = { ...anime, links: pair().map(e => ({ id: e.episodeId, title: e.episodeTitle.replace('qiyi', 'youku'), url: e.url })) };
  globals.animes = [details];
  globals.lastSelectMap.set('测试综艺', { animeIds: [777], sourceBySeason: { default: 'youku' }, preferBySeason: { default: '777' } });
  setSearchCache('测试综艺::fongmi-source:youku', [anime], new Map([[anime.bangumiId, details]]));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must use cached search'); });
  const url = new URL('https://test.invalid/api/v2/fongmi/danmaku?name=测试综艺');
  const items = await (await getFongmiDanmaku(url, new Request(url))).json();
  assert.ok(items.length > 0);
  assert.match(items[0].name, /第0集/);
  assert.ok(items.every(item => /\/comment\/\d+\?format=xml$/.test(item.url)));
});

test('iqiyi combines continuous parts one through four, but not missing or duplicate parts', () => {
  const episodes = fourParts();
  const combined = prepareIqiyiFongmiEpisodes([...episodes].reverse(), RAW);
  assert.equal(combined.length, 1);
  assert.deepEqual(decodeIqiyiConcat(combined[0].iqiyiConcatUrl), episodes.map(e => e.url));
  assert.match(combined[0].episodeTitle, /第3期上 正片/);
  for (const invalid of [[episodes[0], episodes[2], episodes[3]], [...episodes, episodes[2]]]) {
    assert.ok(prepareIqiyiFongmiEpisodes(invalid, RAW).every(e => !e.iqiyiConcatUrl));
  }
  const numeric = episodes.map((e, index) => ({ ...e, episodeTitle: `【qiyi】 第3期上(${index + 1}) 正片` }));
  assert.equal(prepareIqiyiFongmiEpisodes(numeric, RAW).length, 1);
  for (const [suffix, id] of [['(三)', 50272], ['（四）', 50273], ['(3)', 50272], ['（4）', 50273]]) {
    assert.deepEqual(prepareIqiyiFongmiEpisodes(episodes, `第03期上${suffix}.mp4`).map(e => e.episodeId), [id]);
  }
  assert.deepEqual(prepareIqiyiFongmiEpisodes(episodes, '第03期上(五).mp4'), []);
});

test('iqiyi bangumi details expose a manual merge item while preserving single parts', async () => {
  const globals = resetConfig();
  const anime = {
    animeId: 8256680, bangumiId: '249m6jnptgg',
    animeTitle: '萌探探探案第2季(2022)【综艺】from iqiyi', source: 'iqiyi',
    links: fourParts().map(e => ({ id: e.episodeId, title: e.episodeTitle, url: e.url }))
  };
  globals.animes = [anime];
  const data = await (await getManualBangumi('/api/v2/bangumi/8256680')).json();
  const episodes = data.bangumi.episodes;
  assert.equal(episodes.filter(e => /\(一\)|（一）/.test(e.episodeTitle)).length, 1);
  const merged = episodes.find(e => e.episodeTitle.includes('合并分段'));
  assert.ok(merged);
  assert.ok(merged.url.startsWith(IQIYI_CONCAT_PREFIX));
  assert.deepEqual(decodeIqiyiConcat(merged.url), fourParts().map(e => e.url));
  const automatic = await (await getBangumi('/api/v2/bangumi/8256680')).json();
  assert.equal(automatic.bangumi.episodes.some(e => e.episodeTitle.includes('合并分段')), false);
});

test('iqiyi manual merge does not add virtual items to non-iqiyi titles', async () => {
  const globals = resetConfig();
  const anime = {
    animeId: 8256680, bangumiId: '249m6jnptgg',
    animeTitle: '其它来源番剧', source: 'tencent',
    links: fourParts().map(e => ({ id: e.episodeId, title: e.episodeTitle.replace('【qiyi】', '【qq】'), url: e.url }))
  };
  globals.animes = [anime];
  const data = await (await getManualBangumi('/api/v2/bangumi/8256680')).json();
  assert.equal(data.bangumi.episodes.some(e => e.episodeTitle.includes('合并分段')), false);
});

test('FongMi exact part playback chooses the right single video without AI, including parts three and four', async t => {
  const globals = resetConfig();
  const anime = { animeId: 8256680, bangumiId: '249m6jnptgg', animeTitle: '萌探探探案第2季(2022)【综艺】from iqiyi', source: 'iqiyi' };
  const details = { ...anime, links: fourParts().map(e => ({ id: e.episodeId, title: e.episodeTitle, url: e.url })) };
  globals.animes = [details];
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must use cached search'); });
  for (const explicit of [false, true]) {
    globals.lastSelectMap.set('萌探探探案', { animeIds: [anime.animeId], preferBySeason: { default: anime.animeId }, sourceBySeason: { default: 'iqiyi' }, explicitBySeason: { default: explicit } });
    setSearchCache('萌探探探案::fongmi-source:iqiyi', [anime], new Map([[anime.bangumiId, details]]));
    for (const [index, suffix] of ['一', '二', '三', '四'].entries()) {
      const url = new URL('https://test.invalid/api/v2/fongmi/danmaku?name=萌探探探案');
      url.searchParams.set('episode', `第03期上(${suffix}).mp4`);
      const items = await (await getFongmiDanmaku(url, new Request(url))).json();
      assert.equal(items.length, 1, `${suffix}, manual=${explicit}`);
      assert.match(items[0].url, new RegExp(`/comment/${50270 + index}\\?format=xml$`));
    }
  }
});

test('four-part timeline uses the sum of all preceding true durations', async () => {
  resetConfig();
  const episodes = fourParts();
  const address = prepareIqiyiFongmiEpisodes(episodes, RAW)[0].iqiyiConcatUrl;
  const durations = [10.5, 20, 30.25, 40];
  let metadataCalls = 0;
  const source = {
    async getEpisodeDanmuSegments(url) { metadataCalls++; return { duration: durations[episodes.findIndex(e => e.url === url)], segmentList: [{ url }] }; },
    async getEpisodeSegmentDanmu({ url }, options) { assert.equal(options, undefined); return [{ timepoint: 1, content: url }]; },
    formatComments: raw => raw
  };
  const data = await (await getIqiyiConcatComment(address, source, 'json', false, true)).json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [1, 11.5, 31.5, 61.75]);
  assert.equal(data.videoDuration, 100.75);
  assert.equal(metadataCalls, 4, 'each video metadata is fetched only once');
});

test('a failed third part still returns the first two parts without caching the partial result', async () => {
  resetConfig();
  const episodes = fourParts().slice(0, 3);
  const address = prepareIqiyiFongmiEpisodes(episodes, RAW)[0].iqiyiConcatUrl;
  const source = {
    async getEpisodeDanmuSegments(url) { return { duration: 100, segmentList: [{ url }] }; },
    async getEpisodeSegmentDanmu({ url }) {
      if (url === episodes[2].url) throw new Error('temporary network failure');
      return [{ timepoint: 2, content: url }];
    },
    formatComments: raw => raw
  };
  const response = await getIqiyiConcatComment(address, source, 'json', false, true);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.comments.map(c => c.m), episodes.slice(0, 2).map(e => e.url));
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [2, 102]);
  assert.equal(getCommentCache(address), null);
  assert.equal(response.headers.get('X-Danmu-Partial'), '1');
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  assert.equal(data.videoDuration, 300);
});

test('a failed middle part keeps later comments at their original timeline positions', async () => {
  resetConfig();
  const episodes = fourParts();
  const address = prepareIqiyiFongmiEpisodes(episodes, RAW)[0].iqiyiConcatUrl;
  const source = {
    async getEpisodeDanmuSegments(url) { return { duration: 100, segmentList: [{ url }] }; },
    async getEpisodeSegmentDanmu({ url }) {
      if (url === episodes[2].url) throw new Error('third part failed');
      return [{ timepoint: 2, content: url }];
    },
    formatComments: raw => raw
  };
  const data = await (await getIqiyiConcatComment(address, source, 'json', false, false)).json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [2, 102, 302]);
});

test('unknown third-part duration returns the first two parts and stops guessing later positions', async () => {
  resetConfig();
  const episodes = fourParts();
  const address = prepareIqiyiFongmiEpisodes(episodes, RAW)[0].iqiyiConcatUrl;
  const requested = [];
  const source = {
    async getEpisodeDanmuSegments(url) {
      requested.push(url);
      if (url === episodes[2].url) throw new Error('metadata unavailable');
      return { duration: 100, segmentList: [{ url }] };
    },
    async getEpisodeSegmentDanmu({ url }) { return [{ timepoint: 2, content: url }]; },
    formatComments: raw => raw
  };
  const response = await getIqiyiConcatComment(address, source, 'json', false, true);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [2, 102]);
  assert.equal(data.videoDuration, undefined);
  assert.ok(!requested.includes(episodes[3].url));
});

test('one failed fragment does not discard successful fragments from the same video', async () => {
  resetConfig();
  const source = {
    async getEpisodeDanmuSegments(url) { return { duration: 100, segmentList: [{ url, index: 1 }, { url, index: 2 }] }; },
    async getEpisodeSegmentDanmu({ url, index }) {
      if (index === 2) throw new Error('fragment failed');
      return [{ timepoint: 2, content: url }];
    },
    formatComments: raw => raw
  };
  const data = await (await getIqiyiConcatComment(ADDRESS, source, 'json', false, false)).json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [2, 102]);
});

test('a successful video with no comments remains valid and preserves its duration', async () => {
  resetConfig();
  const source = {
    async getEpisodeDanmuSegments(url) { return { duration: 100, segmentList: url === FIRST ? [] : [{ url }] }; },
    async getEpisodeSegmentDanmu() { return [{ timepoint: 2, content: 'second' }]; },
    formatComments: raw => raw
  };
  const data = await (await getIqiyiConcatComment(ADDRESS, source, 'json', false, false)).json();
  assert.equal(data.success, true);
  assert.equal(Number(data.comments[0].p.split(',')[0]), 102);
});

test('iqiyi keeps its original empty-array fallback on segment request failure', async t => {
  resetConfig();
  const source = new IqiyiSource();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'failed' }, { status: 503 }));
  const segment = { url: 'https://cmts.iqiyi.com/bullet/test.br' };
  assert.deepEqual(await source.getEpisodeSegmentDanmu(segment), []);
});

test('valid empty iqiyi segments keep their original behavior', async t => {
  resetConfig();
  const source = new IqiyiSource();
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  assert.deepEqual(await source.getEpisodeSegmentDanmu({ url: 'https://cmts.iqiyi.com/bullet/empty.br' }), []);
});

test('concat reuses original manual correction and applies current offset rules even on cached responses', async t => {
  const globals = resetConfig();
  const anime = { animeId: 8256680, bangumiId: '249m6jnptgg', animeTitle: '萌探探探案第2季(2022)【综艺】from iqiyi', source: 'iqiyi' };
  const details = { ...anime, links: pair().map(e => ({ id: e.episodeId, title: e.episodeTitle, url: e.url })) };
  globals.animes = [details];
  globals.lastSelectMap.set('萌探探探案', { animeIds: [anime.animeId, 999], preferBySeason: { default: 999 }, sourceBySeason: { default: 'iqiyi' } });
  const correction = new Request('https://test.invalid/api/v2/fongmi/manual-correction', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalName: '萌探探探案', searchName: '萌探探探案', animeId: anime.animeId, source: 'iqiyi', episodeId: 40270 })
  });
  assert.equal((await (await handleFongmiManualCorrection(correction)).json()).remembered, true);
  assert.equal(globals.lastSelectMap.get('萌探探探案').preferBySeason.default, String(anime.animeId));
  const preference = JSON.stringify([...globals.lastSelectMap]);
  const address = prepareIqiyiFongmiEpisodes(pair(), RAW)[0].iqiyiConcatUrl;
  const source = getSourceByKey('iqiyi');
  t.mock.method(source, 'getEpisodeDanmuSegments', async url => ({ duration: 100, segmentList: [{ url }] }));
  t.mock.method(source, 'getEpisodeSegmentDanmu', async () => [{ showTime: '2', color: 'ffffff', content: 'test' }]);
  const url = new URL('https://test.invalid/api/v2/comment');
  url.searchParams.set('url', address);
  url.searchParams.set('format', 'json');
  const env = { LOG_LEVEL: 'error', COMMENT_CACHE_MIN_COUNT: '0', DANMU_OFFSET: '萌探探探案/S02/E03@iqiyi:5' };
  let data = await (await handleRequest(new Request(url), env, 'test', 'concat-review')).json();
  assert.equal(data.success, true);
  assert.equal(JSON.stringify([...globals.lastSelectMap]), preference);
  assert.equal(globals.lastSelectMap.get('萌探探探案').explicitBySeason.default, true);
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [7, 107]);
  assert.deepEqual(getCommentCache(address).map(c => Number(c.p.split(',')[0])), [2, 102]);
  // 组合请求只读原来的手动记忆，缓存命中时也不额外写入偏好。
  await handleRequest(new Request(url), env, 'test', 'concat-review');
  assert.equal(JSON.stringify([...globals.lastSelectMap]), preference);
  globals.danmuOffsetRules = parseOffsetRules('萌探探探案/S02/E03@iqiyi:10');
  data = await (await getCommentByUrl(address, 'json', false)).json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [12, 112]);
  globals.danmuOffsetRules = parseOffsetRules('萌探探探案/S02/E03@iqiyi%:20');
  // 时长随组合缓存保存，不因视频信息接口暂时不可用而阻止返回已有内容。
  t.mock.method(source, 'getEpisodeDanmuSegments', async () => { throw new Error('cached response must not refetch metadata'); });
  data = await (await getCommentByUrl(address, 'json', false)).json();
  assert.deepEqual(data.comments.map(c => Number(c.p.split(',')[0])), [2.2, 112.2]);
});
