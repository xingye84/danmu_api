// 爱奇艺标题兼容层：重复副标题与综艺“第N期”标题。
import test from 'node:test';
import assert from 'node:assert';
import IqiyiSource from '../../sources/iqiyi.js';

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
