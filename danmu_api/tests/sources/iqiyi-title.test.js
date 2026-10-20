// 爱奇艺标题兼容层：重复副标题与综艺“第N期”标题。
import test from 'node:test';
import assert from 'node:assert';
import IqiyiSource from '../../sources/iqiyi.js';
import { prepareIqiyiFongmiEpisodes } from '../../utils/iqiyi-concat-util.js';

const buildTitle = (epData) => IqiyiSource.prototype._buildEpisodeTitle.call({}, epData);
const ensureNumber = (title, animeTitle, order) =>
  IqiyiSource.prototype._ensureEpisodeNumber.call({}, title, animeTitle, order);

test('iqiyi removes overlapping subtitle text', () => {
  assert.strictEqual(
    buildTitle({
      short_display_name: '第3期上 孙红雷宋亚轩绝美乔装',
      subtitle: '孙红雷宋亚轩绝美乔装 黄子韬努力变聪明'
    }),
    '第3期上 孙红雷宋亚轩绝美乔装 黄子韬努力变聪明'
  );
  assert.strictEqual(
    buildTitle({ short_display_name: '第3期上', subtitle: '第3期上 黄子韬努力变聪明' }),
    '第3期上 黄子韬努力变聪明'
  );
  assert.strictEqual(
    buildTitle({
      short_display_name: '第3期下 张一山郑业成现场结拜',
      subtitle: '第3期下 张一山郑业成现场结拜 华晨宇吞剑对抗沙溢'
    }),
    '第3期下 张一山郑业成现场结拜 华晨宇吞剑对抗沙溢'
  );
});

test('iqiyi does not add 第0集 to variety episode titles', () => {
  assert.strictEqual(
    ensureNumber('第3期上(一) 孙红雷宋亚轩绝美乔装', '萌探探探案第1季', 0),
    '第3期上(一) 孙红雷宋亚轩绝美乔装'
  );
});

test('iqiyi split titles remove the repeated whole-episode subtitle prefix', () => {
  const subtitle = '第4期上 言承旭打假沙溢杨迪土味F4 baby回应拍戏假吃';
  const first = buildTitle({ short_display_name: '第4期上(一) 言承旭打假沙溢杨迪土味F4', subtitle });
  const second = buildTitle({ short_display_name: '第4期上(二) 沙溢演baby像父女', subtitle });
  assert.equal(first, '第4期上(一) 言承旭打假沙溢杨迪土味F4 baby回应拍戏假吃');
  assert.equal(second, '第4期上(二) 沙溢演baby像父女 言承旭打假沙溢杨迪土味F4 baby回应拍戏假吃');
  const merged = prepareIqiyiFongmiEpisodes([first, second].map((title, index) => ({
    episodeId: index + 1, episodeTitle: `【qiyi】 ${title}`,
    url: `https://www.iqiyi.com/v_test${index + 1}.html`
  })));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].episodeTitle, '【qiyi】 第4期上 言承旭打假沙溢杨迪土味F4 baby回应拍戏假吃');
  assert.equal(buildTitle({
    short_display_name: '第03期下（一） 张一山郑业成现场结拜',
    subtitle: '第3期下 张一山郑业成现场结拜 华晨宇吞剑对抗沙溢'
  }), '第03期下（一） 张一山郑业成现场结拜 华晨宇吞剑对抗沙溢');
});

test('iqiyi keeps subtitle episode labels that do not match the base', () => {
  assert.equal(buildTitle({ short_display_name: '第4期上(一) 文案', subtitle: '第4期下 另一文案' }),
    '第4期上(一) 文案 第4期下 另一文案');
  assert.equal(buildTitle({ short_display_name: '第4期上(一) 文案', subtitle: '第5期上 另一文案' }),
    '第4期上(一) 文案 第5期上 另一文案');
});
