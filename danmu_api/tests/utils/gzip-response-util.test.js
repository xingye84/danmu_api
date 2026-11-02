import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'zlib';
import { buildOutboundResponse, buildOutboundWebResponse } from '../../utils/gzip-response-util.js';

function header(outbound, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(outbound.headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function makeResponse(body, contentType = 'application/xml', status = 200) {
  const headers = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  };
  if (status !== 204 && status !== 304) {
    headers['Content-Length'] = String(Buffer.byteLength(body || ''));
  }
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

test('无 Accept-Encoding 时不压缩', async () => {
  const raw = 'x'.repeat(2048);
  const outbound = await buildOutboundResponse(makeResponse(raw), '');
  assert.equal(outbound.isBase64Encoded, false);
  assert.equal(header(outbound, 'Content-Encoding'), undefined);
  assert.equal(outbound.body.toString('utf8'), raw);
  assert.equal(header(outbound, 'Content-Length'), String(raw.length));
  assert.equal(header(outbound, 'Access-Control-Allow-Origin'), '*');
});

test('Accept-Encoding 含 gzip 且体积足够时压缩 xml', async () => {
  const raw = '<?xml version="1.0"?><i>' + '<d p="1">hi</d>'.repeat(200) + '</i>';
  const outbound = await buildOutboundResponse(makeResponse(raw), 'gzip, deflate');
  assert.equal(outbound.isBase64Encoded, true);
  assert.equal(header(outbound, 'Content-Encoding'), 'gzip');
  assert.equal(header(outbound, 'Vary'), 'Accept-Encoding');
  assert.equal(zlib.gunzipSync(outbound.body).toString('utf8'), raw);
  assert.equal(header(outbound, 'Content-Length'), String(outbound.body.length));
});

test('小于 1KB 不压缩', async () => {
  const raw = '<i><d p="1">hi</d></i>';
  const outbound = await buildOutboundResponse(makeResponse(raw), 'gzip');
  assert.equal(outbound.isBase64Encoded, false);
  assert.equal(header(outbound, 'Content-Encoding'), undefined);
  assert.equal(outbound.body.toString('utf8'), raw);
});

test('非文本类型不压缩', async () => {
  const raw = Buffer.alloc(2048, 7);
  const outbound = await buildOutboundResponse(
    new Response(raw, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
    'gzip',
  );
  assert.equal(outbound.isBase64Encoded, false);
  assert.equal(header(outbound, 'Content-Encoding'), undefined);
  assert.deepEqual(outbound.body, raw);
});

test('204 不写 Content-Length 也不压缩', async () => {
  const outbound = await buildOutboundResponse(makeResponse(null, 'text/plain', 204), 'gzip');
  assert.equal(outbound.status, 204);
  assert.equal(outbound.isBase64Encoded, false);
  assert.equal(header(outbound, 'Content-Encoding'), undefined);
  assert.equal(header(outbound, 'Content-Length'), undefined);
});

test('buildOutboundWebResponse 对 204 使用 null body', async () => {
  const response = await buildOutboundWebResponse(makeResponse(null, 'text/plain', 204), 'gzip');
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(await response.arrayBuffer().then((buf) => buf.byteLength), 0);
});

test('gzip;q=0 不压缩', async () => {
  const raw = 'x'.repeat(2048);
  const outbound = await buildOutboundResponse(makeResponse(raw), 'gzip;q=0, identity');
  assert.equal(outbound.isBase64Encoded, false);
  assert.equal(header(outbound, 'Content-Encoding'), undefined);
  assert.equal(outbound.body.toString('utf8'), raw);
});

test('buildOutboundWebResponse 在支持 gzip 时返回压缩 Response', async () => {
  const raw = '<?xml version="1.0"?><i>' + '<d p="1">hi</d>'.repeat(200) + '</i>';
  const response = await buildOutboundWebResponse(makeResponse(raw), 'gzip');
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.equal(zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'), raw);
});

test('forceGzip 在无 Accept-Encoding 时仍压缩', async () => {
  const raw = 'x'.repeat(2048);
  const outbound = await buildOutboundResponse(makeResponse(raw), '', { forceGzip: true });
  assert.equal(outbound.isBase64Encoded, true);
  assert.equal(header(outbound, 'Content-Encoding'), 'gzip');
  assert.equal(zlib.gunzipSync(outbound.body).toString('utf8'), raw);
});
