import { decodeIqiyiConcatPayload } from '../../utils/iqiyi-concat-util.js';
import { getCommentCache, setCommentCache, resolveEpisodeContextById } from '../../utils/cache-util.js';
import { convertToDanmakuJson, formatDanmuResponse } from '../../utils/danmu-util.js';
import { applyOffset, resolveOffsetRule } from '../../utils/offset-util.js';
import { extractAnimeInfo } from '../../utils/common-util.js';
import { jsonResponse, sourceLogContext } from '../../utils/http-util.js';
import { log } from '../../utils/log-util.js';
import { globals } from '../../configs/globals.js';
import { hasIqiyiSegmentFailure } from '../../utils/iqiyi-segment-util.js';

// source 由现有入口传入，沿用爱奇艺采集和 HTTP 转发，不让 spider_dm 解析组合地址。
export async function getIqiyiConcatComment(address, source, format, segmentFlag, includeDuration) {
  let payload;
  try { payload = decodeIqiyiConcatPayload(address); }
  catch (error) { return jsonResponse({ success: false, errorMessage: error.message, comments: [], count: 0 }, 400); }
  if (segmentFlag) {
    return jsonResponse({ success: false, errorMessage: 'Iqiyi concat supports full comments only', comments: [], count: 0 }, 400);
  }

  const { urls, episodeId } = payload;
  // 只从现有源详情恢复身份，不信任组合地址里自报的剧名或偏移规则。
  const resolved = episodeId == null ? null : resolveEpisodeContextById(episodeId);
  const context = resolved?.anime?.source === 'iqiyi' && resolved.link.url === urls[0] &&
    urls.every(url => resolved.anime.links.some(link => link.url === url)) ? resolved : null;
  const info = context ? extractAnimeInfo(context.anime.animeTitle, context.link.title) : null;
  const episode = context?.link.title.match(/第\s*(\d+)\s*期/)?.[1] || info?.episode ||
    (context ? context.anime.links.indexOf(context.link) + 1 : 1);
  const rule = info ? resolveOffsetRule(globals.danmuOffsetRules, {
    anime: info.baseTitle, season: `S${String(info.season || 1).padStart(2, '0')}`,
    episode: `E${String(Number(episode)).padStart(2, '0')}`, source: 'iqiyi'
  }) : null;
  const withDuration = includeDuration && String(format || globals.danmuOutputFormat || 'json').toLowerCase() === 'json';
  const cached = getCommentCache(address);
  let comments = cached;
  let duration = cached === null ? null : globals.commentCache.get(address)?.videoDuration;
  let partial = false;
  try {
    if (cached === null) {
      let offset = 0;
      let combined = [];
      let complete = true;
      for (const url of urls) {
        let segments;
        try { segments = await sourceLogContext.run('iqiyi', () => source.getEpisodeDanmuSegments(url)); }
        catch (error) {
          partial = true;
          complete = false;
          log('warn', `[iqiyi][concat] ${error.message}`);
        }
        const partDuration = Number(segments?.duration);
        if (!Number.isFinite(partDuration) || partDuration <= 0) {
          // 时长未知则返回已取得的内容；后续段无法准确定位，不猜偏移。
          partial = true;
          complete = false;
          break;
        }
        try {
          // 复用原有采集方法；个别分片失败不影响其它分片。
          const batches = await sourceLogContext.run('iqiyi', () => Promise.allSettled(
            (segments.segmentList || []).map(async segment => source.getEpisodeSegmentDanmu(segment))
          ));
          if (batches.some(batch => batch.status === 'rejected' ||
              (batch.status === 'fulfilled' && !Array.isArray(batch.value))) ||
              (segments.segmentList || []).some(hasIqiyiSegmentFailure)) partial = true;
          const raw = batches.filter(batch => batch.status === 'fulfilled' && Array.isArray(batch.value)).flatMap(batch => batch.value);
          combined = combined.concat(applyOffset(source.formatComments(raw), offset));
        } catch (error) {
          partial = true;
          log('warn', `[iqiyi][concat] ${error.message}`);
        }
        // 即使本段没有弹幕，也保留它在视频时间轴中占据的长度。
        offset += partDuration;
      }
      duration = complete ? offset : null;
      comments = convertToDanmakuJson(combined, 'qiyi');
      if (comments.length && !partial) {
        setCommentCache(address, comments);
        globals.commentCache.get(address).videoDuration = duration;
      }
      log('info', `[iqiyi][concat] combined ${urls.length} videos, comments=${comments.length}, partial=${partial}`);
    }
    // 缓存保持原始拼接时间轴，规则在每次返回时应用，避免更改设置后仍命中旧偏移。
    const output = rule?.offset && (!rule.usePercent || duration > 0)
      ? applyOffset(comments, rule.offset, { usePercent: rule.usePercent, videoDuration: duration }) : comments;
    const response = formatDanmuResponse({
      errorCode: 0, success: true, errorMessage: '', count: output.length, comments: output,
      ...(withDuration && duration > 0 && { videoDuration: duration })
    }, format);
    if (partial) {
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Danmu-Partial', '1');
    }
    return response;
  } catch (error) {
    log('warn', `[iqiyi][concat] ${error.message}`);
    return jsonResponse({ success: false, errorMessage: error.message, comments: [], count: 0 }, 503);
  }
}
