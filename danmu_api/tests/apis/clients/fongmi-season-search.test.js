import assert from 'node:assert/strict';
import test from 'node:test';
import { Globals, globals } from '../../../configs/globals.js';
import { getFongmiDanmaku } from '../../../apis/clients/fongmi-api.js';
import { getSourceByKey } from '../../../sources/registry.js';

function resetState(strict = false) {
  Globals.init({ LOG_LEVEL: 'error', ENABLE_ANIME_EPISODE_FILTER: 'false', STRICT_TITLE_MATCH: String(strict) });
  globals.sourceOrderArr = ['youku'];
  globals.aiValid = false;
  globals.aiApiKey = '';
  globals.localCacheValid = globals.redisValid = globals.localRedisValid = false;
  globals.animes = [];
  globals.searchCache.clear();
  globals.favoriteCache.clear();
  globals.lastSelectMap.clear();
}

for (const { wrongTitle, season, strict } of [
  { wrongTitle: '乡村爱情第8季', season: 18, strict: false },
  { wrongTitle: '乡村爱情08（上）', season: 18, strict: false },
  { wrongTitle: '乡村爱情18', season: 1, strict: true }
]) {
  test(`FongMi keeps searching after rejecting ${wrongTitle} for season ${season} (strict=${strict})`, async t => {
    resetState(strict);
    const keyword = `乡村爱情${season}`;
    const targetTitle = `乡村爱情第${season}季`;
    const source = getSourceByKey('youku');
    const searches = [];
    const details = [];
    t.mock.method(globalThis, 'fetch', async () => { assert.fail('unexpected network request'); });
    t.mock.method(source, 'search', async keyword => {
      searches.push(keyword);
      const correct = keyword === targetTitle;
      return [{ title: correct ? targetTitle : wrongTitle, mediaId: correct ? 'correct-season' : 'wrong-season', type: '电视剧', year: 2026 }];
    });
    t.mock.method(source, 'getEpisodes', async mediaId => {
      details.push(mediaId);
      return [{ id: 'season18-episode1', title: '第1集', displayName: '第1集', link: 'https://v.youku.com/v_show/id_season18.html' }];
    });

    const url = new URL('https://test.invalid/api/v2/fongmi/danmaku?episode=第1集');
    url.searchParams.set('name', keyword);
    const response = await getFongmiDanmaku(url, new Request(url));
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 1);
    assert.ok(items[0].name.startsWith(targetTitle));
    assert.deepEqual(searches, [keyword, targetTitle]);
    assert.deepEqual(details, ['correct-season'], 'wrong seasons must be rejected before fetching details');
  });
}

for (const strict of [false, true]) {
  test(`source filtering honors a separate season parameter before fetching details (strict=${strict})`, async t => {
    resetState(strict);
    const source = getSourceByKey('youku');
    t.mock.method(source, 'getEpisodes', async () => { assert.fail('wrong season details must not be requested'); });
    const results = [];
    await source.handleAnimes([{ title: '乡村爱情8（上）', mediaId: 'season8', type: '电视剧', year: 2015 }], '乡村爱情', results, new Map(), 18);
    assert.deepEqual(results, []);
    assert.equal(source.getEpisodes.mock.callCount(), 0);
  });
}
