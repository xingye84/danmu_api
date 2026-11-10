import assert from 'node:assert/strict';
import test from 'node:test';
import { appendIqiyiManualMerge, decodeIqiyiConcat, prepareIqiyiFongmiEpisodes } from '../../utils/iqiyi-concat-util.js';

const reported = [
  { episodeId: 101, episodeTitle: '【qiyi】 第1期(一) 黑人助阵惨被撕 鹿晗吓腿软', url: 'https://www.iqiyi.com/v_19rrlrwzyg.html' },
  { episodeId: 102, episodeTitle: '【qiyi】 第1期(二) 鹿晗被恐怖箱吓腿软 黑人助阵惨被撕 鹿晗吓腿软', url: 'https://www.iqiyi.com/v_vmjaxfwwo8.html' },
  { episodeId: 103, episodeTitle: '【qiyi】 第1期(三) 黑人助阵惨被撕 鹿晗吓腿软', url: 'https://www.iqiyi.com/v_22ftgy4r8to.html' }
];

test('reported unlabelled parts merge in playback order and keep the first title', () => {
  const original = [reported[2], reported[0], reported[1]];
  const before = structuredClone(original);
  const prepared = prepareIqiyiFongmiEpisodes(original, '第01期.mp4');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].episodeTitle, '【qiyi】 第1期 黑人助阵惨被撕 鹿晗吓腿软');
  assert.equal(prepared[0].episodeId, reported[0].episodeId);
  assert.deepEqual(decodeIqiyiConcat(prepared[0].iqiyiConcatUrl), reported.map(e => e.url));
  const manual = appendIqiyiManualMerge({ success: true, bangumi: { episodes: original } }).bangumi.episodes;
  assert.deepEqual(manual.slice(0, 3), original);
  assert.equal(manual[3].episodeTitle, `${prepared[0].episodeTitle}（合并分段）`);
  assert.deepEqual(decodeIqiyiConcat(manual[3].url), reported.map(e => e.url));
  assert.deepEqual(original, before);
});

test('unlabelled parts stay separate from upper/middle/lower, other issues and dates', () => {
  const groups = [reported, ...['上', '中', '下', 'next', 'date'].map((label, index) => reported.map((e, part) => ({
    episodeId: 201 + index * 10 + part,
    episodeTitle: label === 'next' ? e.episodeTitle.replace('第1期', '第2期')
      : label === 'date' ? `${e.episodeTitle} 2016-04-16` : e.episodeTitle.replace('第1期', `第1期${label}`),
    url: `https://www.iqiyi.com/v_group${index}part${part}.html`
  })))];
  const prepared = prepareIqiyiFongmiEpisodes(groups.flat());
  assert.equal(prepared.length, groups.length);
  for (const [index, group] of groups.entries()) {
    assert.deepEqual(decodeIqiyiConcat(prepared[index].iqiyiConcatUrl), group.map(e => e.url));
  }
  for (const suffix of ['(二)', '（2）']) {
    const selected = prepareIqiyiFongmiEpisodes(groups.flat(), `第01期${suffix}.mp4`);
    assert.deepEqual(selected.map(e => e.episodeId), [reported[1].episodeId, groups[5][1].episodeId]);
    assert.ok(selected.every(e => !e.iqiyiConcatUrl));
  }
});

test('unlabelled numeric and full-width part markers merge and select individual parts', () => {
  const numeric = reported.map((e, index) => ({ ...e, episodeTitle: `【qiyi】 第0集 第1期（${index + 1}） 正片` }));
  const prepared = prepareIqiyiFongmiEpisodes(numeric);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].episodeTitle, '【qiyi】 第1期 正片');
  assert.deepEqual(decodeIqiyiConcat(prepared[0].iqiyiConcatUrl), reported.map(e => e.url));
  for (const suffix of ['(三)', '（3）']) {
    assert.deepEqual(prepareIqiyiFongmiEpisodes(numeric, `第01期${suffix}.mp4`).map(e => e.episodeId), [103]);
  }
  assert.deepEqual(prepareIqiyiFongmiEpisodes(numeric, '第01期(四).mp4'), []);
});

test('unlabelled missing, duplicate and special-version parts do not form a merge', () => {
  for (const episodes of [
    [reported[0], reported[2]],
    [...reported, reported[1]],
    [reported[0], { ...reported[1], episodeTitle: `${reported[1].episodeTitle}（纯享版）` }],
    reported.map(e => ({ ...e, episodeTitle: e.episodeTitle.replace('第1期', '第0集 精编版') }))
  ]) {
    const details = { success: true, bangumi: { episodes } };
    assert.equal(appendIqiyiManualMerge(details), details);
    assert.ok(prepareIqiyiFongmiEpisodes(episodes).every(e => !e.iqiyiConcatUrl));
  }
});
