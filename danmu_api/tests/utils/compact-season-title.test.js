import assert from 'node:assert/strict';
import test from 'node:test';
import { Globals } from '../../configs/globals.js';
import { titleMatches } from '../../utils/common-util.js';

test('compact sequel numbers cannot match a different season of the same title', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'false', LOG_LEVEL: 'error' });
  for (const query of ['乡村爱情第18季', '乡村爱情18', '乡村爱情 Season 18', '乡村爱情第十八季']) {
    for (const title of ['乡村爱情8', '乡村爱情8（上）', '乡村爱情8(下)(2015)【电视剧】from youku']) {
      assert.equal(titleMatches(title, query), false, `${title} / ${query}`);
    }
  }
  assert.equal(titleMatches('乡村爱情18（下）', '乡村爱情第8季'), false);
  assert.equal(titleMatches('乡村爱情8（上）', '乡村爱情第18季(2026)'), false);
  assert.equal(titleMatches('乡村爱情8', '乡村爱情第18季', 18), false);
});

test('matching compact seasons retain split labels, years and title normalization', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'false', LOG_LEVEL: 'error' });
  for (const title of ['乡村爱情18', '乡村爱情18（上）', '乡村爱情18(下)(2026)【电视剧】from youku', '鄉村愛情 18（上）']) {
    assert.equal(titleMatches(title, '乡村爱情第18季'), true, title);
  }
});

test('compact queries reject explicit and zero-padded seasons with different numbers', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'false', LOG_LEVEL: 'error' });
  for (const title of ['乡村爱情第8季', '乡村爱情第八季', '乡村爱情 S08', '乡村爱情 Season 08', '乡村爱情 Part 08', '乡村爱情08（上）']) {
    assert.equal(titleMatches(title, '乡村爱情18'), false, title);
    assert.equal(titleMatches(title, '乡村爱情第18季'), false, title);
  }
  assert.equal(titleMatches('乡村爱情08（上）', '乡村爱情第8季'), true);
  assert.equal(titleMatches('乡村爱情第18季', '乡村爱情18'), true);
});

test('separate season parameters reject compact mismatches but retain matching and unnumbered works', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'false', LOG_LEVEL: 'error' });
  assert.equal(titleMatches('乡村爱情8（上）', '乡村爱情', 18), false);
  assert.equal(titleMatches('乡村爱情08', '乡村爱情', 18), false);
  assert.equal(titleMatches('乡村爱情18（上）', '乡村爱情', 18), true);
  assert.equal(titleMatches('乡村爱情', '乡村爱情', 18), true);
  assert.equal(titleMatches('大宋少年志2', '大宋少年志2', 1), true);
  assert.equal(titleMatches('机动战士高达00', '机动战士高达00', 2), true);
  assert.equal(titleMatches('请回答1988', '请回答1988', 2), true);
});

test('unseasoned long-running titles and numeric work names retain their fallback', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'false', LOG_LEVEL: 'error' });
  for (const [title, query] of [
    ['乡村爱情', '乡村爱情第18季'],
    ['请回答1988', '请回答1988第2季'],
    ['机动战士高达00', '机动战士高达00第2季'],
    ['灵能百分百100', '灵能百分百100第2季'],
    ['大宋少年志2', '大宋少年志2第2季'],
    ['乡村爱情(2018)', '乡村爱情第18季'],
    ['乡村爱情8', '乡村爱情']
  ]) assert.equal(titleMatches(title, query), true, `${title} / ${query}`);
});

test('strict mode rejects conflicting season numbers before accepting title prefixes', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'true', LOG_LEVEL: 'error' });
  assert.equal(titleMatches('乡村爱情18', '乡村爱情1'), false);
  assert.equal(titleMatches('乡村爱情18（真彩）', '乡村爱情1'), false);
  assert.equal(titleMatches('乡村爱情18', '乡村爱情1（真彩）'), false);
  assert.equal(titleMatches('乡村爱情8（上）', '乡村爱情', 18), false);
  assert.equal(titleMatches('乡村爱情18', '乡村爱情1', null, true), false);
});

test('season checks retain strict matching rules, noise removal and non-strict overrides', () => {
  Globals.init({ STRICT_TITLE_MATCH: 'true', LOG_LEVEL: 'error' });
  assert.equal(titleMatches('乡村爱情18', '乡村爱情18'), true);
  assert.equal(titleMatches('乡村爱情18（上）', '乡村爱情18'), false);
  assert.equal(titleMatches('乡村爱情18', '乡村爱情18（真彩）'), true);
  assert.equal(titleMatches('无职转生 第二季', '无职转生'), true);
  assert.equal(titleMatches('某某无职转生', '无职转生'), false);
  assert.equal(titleMatches('无职转生 到了异世界', '无职转生'), false);
  assert.equal(titleMatches('某某无职转生', '无职转生', null, true), true);
  assert.equal(titleMatches('大宋少年志2', '大宋少年志2', 1), true);
  assert.equal(titleMatches('请回答1988', '请回答1988', 2), true);
});

test('titles ending in 上中下 retain their names when using a separate season parameter', () => {
  for (const strict of [false, true]) {
    Globals.init({ STRICT_TITLE_MATCH: String(strict), LOG_LEVEL: 'error' });
    for (const base of ['一人之下', '天下', '初中']) {
      assert.equal(titleMatches(`${base}2`, base, 3), false, base);
      assert.equal(titleMatches(`${base}2`, base, 2), true, base);
    }
    assert.equal(titleMatches('乡村爱情18下', '乡村爱情1'), false);
  }
});
