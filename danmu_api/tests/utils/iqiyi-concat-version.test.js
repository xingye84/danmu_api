import assert from 'node:assert/strict';
import test from 'node:test';
import { appendIqiyiManualMerge, decodeIqiyiConcat, prepareIqiyiFongmiEpisodes } from '../../utils/iqiyi-concat-util.js';
import { buildIqiyiEpisodeTitle } from '../../utils/iqiyi-title-util.js';

const reported = [
  { episodeId: 11, episodeTitle: '【qiyi】 第11期下(一) 虎鹤妖师录爆笑番外 孙红雷高喊谢娜妖怪', url: 'https://www.iqiyi.com/v_1ep7ilnlx6c.html' },
  { episodeId: 12, episodeTitle: '【qiyi】 第11期下(二) 孙红雷高喊谢娜妖怪 第11期下(二)虎鹤妖师录爆笑番外 孙红雷高喊谢娜妖怪', url: 'https://www.iqiyi.com/v_20xz9o3dtzg.html' }
];

test('reported regular parts with 番外 in their description still merge using the first title', () => {
  const before = structuredClone(reported);
  const prepared = prepareIqiyiFongmiEpisodes(reported);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].episodeTitle, '【qiyi】 第11期下 虎鹤妖师录爆笑番外 孙红雷高喊谢娜妖怪');
  assert.deepEqual(decodeIqiyiConcat(prepared[0].iqiyiConcatUrl), reported.map(e => e.url));
  const manual = appendIqiyiManualMerge({ success: true, bangumi: { episodes: reported } }).bangumi.episodes;
  assert.equal(manual.length, 3);
  assert.deepEqual(manual.slice(0, 2), reported);
  assert.equal(manual[2].episodeTitle, `${prepared[0].episodeTitle}（合并分段）`);
  assert.deepEqual(reported, before);
});

test('version words inside regular descriptions do not block merging', () => {
  for (const description of [
    '嘉宾演出纯享舞台', '嘉宾讨论加更安排', '导演揭秘花絮拍摄', '嘉宾讲述未播故事',
    '虎鹤妖师录爆笑番外', '演员观看预告片', '嘉宾欣赏先导片', '嘉宾体验会员版玩法'
  ]) {
    const episodes = reported.map((e, index) => ({
      ...e, episodeTitle: `【qiyi】 第11期下(${index + 1}) ${description}`
    }));
    assert.equal(prepareIqiyiFongmiEpisodes(episodes).length, 1, description);
  }
});

test('explicit special version markers remain separate and do not prevent regular parts from merging', () => {
  for (const marker of ['纯享', '纯享版', '加更', '加更版', '花絮', '花絮版', '未播', '未播版', '番外', '番外篇', '预告', '预告片', '先导', '先导片', '会员版']) {
    for (const text of [`${marker} 嘉宾互动`, `【${marker}】 嘉宾互动`, `：${marker} 嘉宾互动`, `嘉宾互动 ${marker}`, `嘉宾互动（${marker}）`]) {
      const special = reported.map((e, index) => ({
        episodeId: 21 + index,
        episodeTitle: `【qiyi】 第11期下(${index + 1}) ${text}`,
        url: `https://www.iqiyi.com/v_special${index}.html`
      }));
      assert.deepEqual(prepareIqiyiFongmiEpisodes(special), special, text);
      const prepared = prepareIqiyiFongmiEpisodes([...reported, ...special]);
      assert.equal(prepared.length, 3, text);
      assert.deepEqual(decodeIqiyiConcat(prepared[0].iqiyiConcatUrl), reported.map(e => e.url));
      assert.deepEqual(prepared.slice(1), special, text);
    }
  }
});

test('special version suffixes cannot fill a missing regular segment', () => {
  for (const marker of ['未播版', '番外篇', '花絮版']) {
    const specialSecond = {
      ...reported[1],
      episodeTitle: `【qiyi】 第11期下(二) 嘉宾互动（${marker}）`
    };
    const mixed = [reported[0], specialSecond];
    assert.deepEqual(prepareIqiyiFongmiEpisodes(mixed), mixed, marker);
    const manual = { success: true, bangumi: { episodes: mixed } };
    assert.equal(appendIqiyiManualMerge(manual), manual, marker);
  }
});

test('explicit bracketed versions still prevent merging after subtitle text is appended', () => {
  for (const marker of ['纯享版', '加更版', '花絮版', '未播版', '番外篇', '预告片', '先导片', '会员版']) {
    for (const [open, close] of [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']']]) {
      const special = reported.map((e, index) => ({
        ...e,
        episodeTitle: '【qiyi】 ' + buildIqiyiEpisodeTitle({
          short_display_name: `第11期下(${index + 1}) 嘉宾互动${open}${marker}${close}`,
          subtitle: '嘉宾分享拍摄趣事'
        })
      }));
      assert.deepEqual(prepareIqiyiFongmiEpisodes(special), special, `${open}${marker}${close}`);
      assert.deepEqual(prepareIqiyiFongmiEpisodes([reported[0], special[1]]), [reported[0], special[1]], marker);
    }
  }
  const regular = reported.map(e => ({ ...e, episodeTitle: `${e.episodeTitle}（虎鹤妖师录爆笑番外）` }));
  assert.equal(prepareIqiyiFongmiEpisodes(regular).length, 1);
});
