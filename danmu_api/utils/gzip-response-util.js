import zlib from 'zlib';
import { log } from './log-util.js';

function acceptsGzip(acceptEncoding) {
  const raw = String(acceptEncoding || '').toLowerCase();
  if (!raw.includes('gzip')) return false;
  for (const part of raw.split(',')) {
    const [coding, ...params] = part.trim().split(';').map((item) => item.trim());
    if (coding !== 'gzip') continue;
    const qParam = params.find((item) => item.startsWith('q='));
    if (!qParam) return true;
    const q = Number(qParam.slice(2));
    return !(Number.isFinite(q) && q <= 0);
  }
  return false;
}

function isCompressibleType(contentType) {
  const type = String(contentType || '').toLowerCase();
  return type.includes('xml') || type.includes('json') || type.includes('text');
}

function mergeVaryAcceptEncoding(existing) {
  const parts = String(existing || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === 'accept-encoding')) {
    parts.push('Accept-Encoding');
  }
  return parts.join(', ');
}

function shouldOmitContentLength(status) {
  return status === 204 || status === 304;
}

/** 按 Accept-Encoding 协商出口 gzip；forceGzip 用于 Vercel 突破 4.5MB。 */
export async function buildOutboundResponse(webResponse, acceptEncoding, options = {}) {
  const forceGzip = !!options.forceGzip;
  const headers = {};
  webResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'content-encoding' || lowerKey === 'content-length') return;
    headers[key] = value;
  });

  let body = Buffer.from(await webResponse.arrayBuffer());
  const contentType = webResponse.headers.get('content-type') || '';
  let gzipped = false;
  const omitLength = shouldOmitContentLength(webResponse.status);
  const rawLength = body.length;
  const wantGzip = forceGzip || acceptsGzip(acceptEncoding);
  const canGzip = !omitLength && wantGzip && rawLength > 1024 && isCompressibleType(contentType);

  if (canGzip) {
    try {
      body = zlib.gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = mergeVaryAcceptEncoding(headers['Vary'] || headers['vary']);
      delete headers['vary'];
      gzipped = true;
    } catch (error) {
      log('error', `[GZIP] Compression failed, falling back to raw: ${error.message}`);
    }
  }

  if (rawLength > 100000) {
    log('info', `[GZIP] raw=${rawLength} out=${body.length} gzipped=${gzipped} force=${forceGzip} ae=${JSON.stringify(String(acceptEncoding || ''))}`);
  }

  if (!omitLength) {
    headers['Content-Length'] = String(body.length);
  }

  return {
    status: webResponse.status,
    headers,
    body,
    isBase64Encoded: gzipped,
  };
}

export async function buildOutboundWebResponse(webResponse, acceptEncoding, options = {}) {
  const outbound = await buildOutboundResponse(webResponse, acceptEncoding, options);
  if (shouldOmitContentLength(outbound.status)) {
    return new Response(null, {
      status: outbound.status,
      headers: outbound.headers,
    });
  }
  return new Response(outbound.body, {
    status: outbound.status,
    headers: outbound.headers,
  });
}
