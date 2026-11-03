import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { apitestJsContent } from '../../ui/js/apitest.js';
import { appendIqiyiManualMerge } from '../../utils/iqiyi-concat-util.js';

function makePage() {
  const requests = [];
  const alerts = [];
  const downloads = [];
  const failures = [];
  const elements = new Map();
  const context = vm.createContext({
    URL, URLSearchParams, Blob, performance,
    setTimeout() {},
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', value: '' });
        return elements.get(id);
      },
      createElement() { return { click() { downloads.push(this.download); } }; },
      body: { appendChild() {}, removeChild() {} }
    },
    fetch: async url => {
      requests.push(url);
      return new Response(JSON.stringify({ comments: [{ p: '1,1,25,16777215', m: 'first' }, { p: '101,1,25,16777215', m: 'second' }], videoDuration: 200 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    },
    addLog() {}, customAlert: message => alerts.push(message),
    buildApiUrl: path => '/user-token' + path
  });
  vm.runInContext(apitestJsContent, context);
  // Keep the real request, selection state and export code; stub unrelated visual rendering.
  vm.runInContext(`
    cloneDanmuCallTrace = () => null;
    showDanmuView = () => {};
    finishDanmuCallStep = () => {};
    finishDanmuCallFailure = (_trace, _start, step) => failures.push(step.url);
    renderDanmuCallFailure = () => '';
    backBtnHtml = () => '';
    getDanmuFilterCounts = () => ({});
    renderDanmuSourceUrl = () => '';
    renderDanmuCallTrace = () => '';
    renderDanmuFilterTabs = () => '';
    applyDanmuFilter = () => {};
    renderDanmuStats = () => {};
    renderDanmuHeatmap = () => {};
    renderDanmuList = () => {};
  `, Object.assign(context, { failures }));
  return { context, requests, alerts, downloads, failures, elements };
}

function mergedEpisode() {
  const episodes = [1, 2].map(part => ({
    episodeId: 10000 + part,
    episodeNumber: String(part),
    episodeTitle: `【qiyi】 第1期下(${part}) 正片`,
    url: `https://www.iqiyi.com/v_part${part}.html`
  }));
  return appendIqiyiManualMerge({ success: true, bangumi: { episodes } }).bangumi.episodes[2];
}

test('manual merge loading and export use the full concat address with the token prefix', async () => {
  const page = makePage();
  const merged = mergedEpisode();
  await page.context.fetchDanmuForTest(merged.episodeId, merged.episodeTitle, 'manual', null, merged.url);
  page.context.document.getElementById('danmu-export-format').value = 'xml';
  await page.context.exportDanmu();
  assert.equal(page.requests.length, 2);
  for (const [index, request] of page.requests.entries()) {
    const url = new URL(request, 'https://test.invalid');
    assert.equal(url.pathname, '/user-token/api/v2/comment');
    assert.equal(url.searchParams.get('url'), merged.url);
    assert.equal(url.searchParams.get('format'), index === 0 ? 'json' : 'xml');
    assert.equal(url.searchParams.get('duration'), index === 0 ? 'true' : null);
  }
  assert.equal(page.downloads.length, 1);
  assert.equal(page.alerts.length, 0);
});

test('switching from a merge to ordinary manual or automatic playback clears the concat address', async () => {
  for (const [source, sourceUrl] of [['manual', 'https://www.iqiyi.com/v_part1.html'], ['auto', mergedEpisode().url]]) {
    const page = makePage();
    const merged = mergedEpisode();
    await page.context.fetchDanmuForTest(merged.episodeId, merged.episodeTitle, 'manual', null, merged.url);
    await page.context.fetchDanmuForTest(10002, '普通分段', source, null, sourceUrl);
    await page.context.exportDanmu();
    assert.equal(page.requests[1], '/user-token/api/v2/comment/10002?format=json&duration=true');
    assert.equal(page.requests[2], '/user-token/api/v2/comment/10002?format=json');
    assert.equal(page.alerts.length, 0);
  }
});

test('a failed merge load records the actual concat request in the failure trace', async () => {
  const page = makePage();
  page.context.fetch = async url => { page.requests.push(url); return new Response(null, { status: 503 }); };
  const merged = mergedEpisode();
  await page.context.fetchDanmuForTest(merged.episodeId, merged.episodeTitle, 'manual', null, merged.url);
  assert.equal(new URL(page.requests[0], 'https://test.invalid').searchParams.get('url'), merged.url);
  assert.equal(page.failures[0], page.requests[0].slice('/user-token'.length));
  assert.equal(page.alerts.length, 1);
});
