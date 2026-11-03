import assert from 'node:assert/strict';
import test from 'node:test';
import { appendIqiyiManualMerge, decodeIqiyiConcat } from '../../utils/iqiyi-concat-util.js';

function parts(number, label, date = '') {
  return ['一', '二'].map((part, index) => ({
    episodeId: Number(`${number}${label === '上' ? 1 : 2}${date.replaceAll('-', '')}${index}`),
    episodeTitle: `【qiyi】 第0集 第${number}期${label}(${part}) 正片 ${date}`,
    url: `https://www.iqiyi.com/v_ep${number}${label === '上' ? 'u' : 'l'}${date.replaceAll('-', '')}${index}.html`
  }));
}

function details(episodes) {
  return { success: true, bangumi: { animeTitle: '萌探探探案第三季', episodes } };
}

test('manual merges follow their own upper/lower parts before later episodes and extras', () => {
  const upper = parts(1, '上');
  const lower = parts(1, '下');
  const next = parts(2, '上');
  const extra = { episodeId: 'extra', episodeTitle: '【qiyi】 第1期番外', url: 'https://www.iqiyi.com/v_extra.html' };
  const original = details([...upper, ...lower, extra, ...next]);
  const before = structuredClone(original);
  const result = appendIqiyiManualMerge(original);
  const episodes = result.bangumi.episodes;

  assert.deepEqual(episodes.filter(e => !e.iqiyiConcatUrl), original.bangumi.episodes);
  assert.deepEqual(episodes.map(e => e.iqiyiConcatUrl ? 'merged' : e.episodeId), [
    ...upper.map(e => e.episodeId), 'merged',
    ...lower.map(e => e.episodeId), 'merged', extra.episodeId,
    ...next.map(e => e.episodeId), 'merged'
  ]);
  for (const [index, group] of [[2, upper], [5, lower], [9, next]]) {
    assert.match(episodes[index].episodeTitle, /（合并分段）$/);
    assert.deepEqual(decodeIqiyiConcat(episodes[index].url), group.map(e => e.url));
  }
  assert.deepEqual(original, before, 'source details must not be mutated');
});

test('manual merges follow the last displayed segment even when parts and dates are interleaved', () => {
  const firstDate = parts(3, '下', '2023-04-28');
  const secondDate = parts(3, '下', '2023-04-29');
  const original = [firstDate[1], secondDate[0], firstDate[0], secondDate[1]];
  const episodes = appendIqiyiManualMerge(details(original)).bangumi.episodes;

  assert.deepEqual(episodes.filter(e => !e.iqiyiConcatUrl), original);
  assert.equal(episodes[2], firstDate[0]);
  assert.deepEqual(decodeIqiyiConcat(episodes[3].url), firstDate.map(e => e.url));
  assert.equal(episodes[4], secondDate[1]);
  assert.deepEqual(decodeIqiyiConcat(episodes[5].url), secondDate.map(e => e.url));
});

test('manual details without complete iqiyi parts retain their original order', () => {
  const incomplete = details(parts(1, '下').slice(0, 1));
  assert.equal(appendIqiyiManualMerge(incomplete), incomplete);
  const otherSource = details(parts(1, '下').map(e => ({ ...e, episodeTitle: e.episodeTitle.replace('【qiyi】', '【qq】') })));
  assert.equal(appendIqiyiManualMerge(otherSource), otherSource);
});
