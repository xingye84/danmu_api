import assert from 'node:assert/strict';
import test from 'node:test';
import { convertDanmuToXml } from '../../utils/xml-danmu-util.js';

test('convertDanmuToXml 剥离非法控制字符', () => {
  const xml = convertDanmuToXml({
    comments: [{ p: '1.0,1,16777215,[qq]', m: 'a\u0000b\u0008c' }],
  });
  assert.equal(xml.includes('\u0000'), false);
  assert.equal(xml.includes('\u0008'), false);
  assert.match(xml, /<d p="[^"]+">abc<\/d>/);
});
