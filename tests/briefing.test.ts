import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSummaryParts, checkedFetch, extractSummary, fetchMarketSnapshot, koreanDate, parsePlaylist, parseVtt, updateBriefing, validateTranscript, parseCnbcBond, parseFearGreed } from '../summarize-news';

const video = { id: 'abcdefghijk', title: '오늘 뉴스 } "제목"' };
const summary = "## ☕ Market Overview\n시황\n## 🗞️ Today's Briefing\n" + '<details><summary>뉴스</summary><div>본문</div></details>'.repeat(3);
function temp(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-test-'));
  t.after(() => { for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir); });
  return dir;
}
test('playlist selects completed entries, ignoring recommendations and live/upcoming entries', () => {
  const entry = (id: string, extra = {}) => ({ playlistVideoRenderer: { videoId: id, title: { runs: [{ text: video.title }] }, ...extra } });
  const data = { recommendation: { videoId: 'wrongwrong1' }, content: { playlistVideoListRenderer: { contents: [
    entry('livevideo01', { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }] }),
    entry('upcoming001', { upcomingEventData: {} }), entry(video.id), entry(video.id), entry('unavailable', { isPlayable: false }),
  ] } } };
  assert.deepEqual(parsePlaylist(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`), [video]);
  assert.throws(() => parsePlaylist('Sign in to confirm you are not a bot'));
});
test('empty and truncated playlist fail rather than reporting success', () => {
  assert.throws(() => parsePlaylist('var ytInitialData = {'));
  assert.throws(() => parsePlaylist('var ytInitialData = {};'));
});
test('new YouTube lockup layout accepts timed videos but skips live and unrelated sidebar', () => {
  const lockup = (id: string, duration: string) => ({ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: id, metadata: { lockupMetadataViewModel: { title: { content: video.title } } }, contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: duration } }] } }] } } } });
  const data = { contents: { itemSectionRenderer: { contents: [lockup('livevideo01', 'LIVE'), lockup(video.id, '45:58')] } }, sidebar: { itemSectionRenderer: { contents: [lockup('wrongwrong1', '15:00')] } } };
  assert.deepEqual(parsePlaylist('var ytInitialData = ' + JSON.stringify(data) + ';'), [video]);
});
test('VTT cue numbers and headers are removed; repeated speech later is preserved', () => {
  assert.equal(parseVtt('WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n안녕\n\n2\n00:00:01.000 --> 00:00:02.000\n안녕\n<00:00:01.500><c>시장</c>\n\n3\n00:00:02.000 --> 00:00:03.000\n안녕'), '안녕 시장 안녕');
  assert.throws(() => validateTranscript(''));
});
test('caption failure uses structured video input, not a plain URL prompt', () => {
  const parts = buildSummaryParts(video, null);
  assert.equal((parts[0] as any).file_data.file_uri, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(buildSummaryParts(video, '자막'.repeat(100)).length, 1);
});
test('Gemini refusals, empty output and truncated output are rejected', () => {
  const result = (text: string, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
  assert.equal(extractSummary(result(summary)), summary);
  for (const data of [{}, result('SOURCE_UNAVAILABLE'), result(''), result(summary, 'MAX_TOKENS')]) assert.throws(() => extractSummary(data));
});
test('importance selection accepts one or many real issues, with no count quota', () => {
  for (const count of [1, 2, 7]) {
    const text = "## Market Overview\n시황\n## Today's Briefing\n" + '<details><summary>핵심</summary>설명</details>'.repeat(count);
    assert.equal(extractSummary({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }), text);
  }
  const prompt = (buildSummaryParts(video, 'test')[0] as any).text;
  assert.doesNotMatch(prompt, /3-5개/);
  assert.match(prompt, /중요도/);
});
test('CNBC yield change uses basis points, never the bond price percentage', () => {
  const data = { ITVQuoteResult: { ITVQuote: [{ symbol: 'JP10Y-JP', code: '0', type: 'BOND', last: '3.099%', previous_day_closing: '3.088%', change_pct: '-0.0824%', last_timedate: '9:22 AM JST' }] } };
  const result = parseCnbcBond(data, 'JP10Y-JP');
  assert.equal(result.price, 3.099);
  assert.equal(result.changeBp, 1.1);
  assert.equal(result.change, null);
  assert.throws(() => parseCnbcBond(data, 'KR10Y-KR'));
  data.ITVQuoteResult.ITVQuote[0].last = 'N/A';
  assert.throws(() => parseCnbcBond(data, 'JP10Y-JP'));
});
test('CNN validates score and source timestamp rather than relabeling an old value', () => {
  const now = Date.parse('2026-09-29T01:00:00Z');
  const payload = { fear_and_greed: { score: 33.94, rating: 'fear', timestamp: '2026-09-28T23:59:50Z' } };
  const result = parseFearGreed(payload, now);
  assert.equal(result.price, 34);
  assert.equal(result.rating, 'fear');
  assert.equal(result.sourceAsOf, '2026-09-28T23:59:50.000Z');
  assert.throws(() => parseFearGreed(payload, now + 6 * 86400_000));
  assert.throws(() => parseFearGreed({ fear_and_greed: { ...payload.fear_and_greed, score: 101 } }, now));
});
test('failed generation preserves previous report/state and rejects for retry', async t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'news-summary-result.md'), 'previous report');
  fs.writeFileSync(path.join(dir, 'last_processed_videoId.txt'), 'previous-id');
  await assert.rejects(updateBriefing({ directory: dir, latest: async () => video, transcript: async () => null, summarize: async () => { throw new Error('Gemini HTTP 429'); } }));
  assert.equal(fs.readFileSync(path.join(dir, 'news-summary-result.md'), 'utf8'), 'previous report');
  assert.equal(fs.readFileSync(path.join(dir, 'last_processed_videoId.txt'), 'utf8'), 'previous-id');
});
test('video fallback saves provenance; rerun skips API and restores missing state', async t => {
  const dir = temp(t);
  const options = { directory: dir, latest: async () => video, transcript: async () => null, summarize: async (_v: any, text: any) => { assert.equal(text, null); return summary; } };
  assert.equal((await updateBriefing(options)).status, 'updated');
  const report = fs.readFileSync(path.join(dir, 'news-summary-result.md'), 'utf8');
  assert.match(report, /영상 직접 분석/);
  fs.unlinkSync(path.join(dir, 'last_processed_videoId.txt'));
  assert.equal((await updateBriefing({ ...options, summarize: async () => { throw new Error('must not call API twice'); } })).status, 'unchanged');
  assert.equal(fs.readFileSync(path.join(dir, 'last_processed_videoId.txt'), 'utf8').trim(), video.id);
});
test('state alone never suppresses regeneration of a missing report', async t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'last_processed_videoId.txt'), video.id);
  assert.equal((await updateBriefing({ directory: dir, latest: async () => video, transcript: async () => null, summarize: async () => summary })).status, 'updated');
});
test('an existing report from the old selection policy is regenerated for the same video', async t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'news-summary-result.md'), `https://www.youtube.com/watch?v=${video.id}\n${summary}`);
  assert.equal((await updateBriefing({ directory: dir, latest: async () => video, transcript: async () => null, summarize: async () => summary })).status, 'updated');
});
test('report date uses Korea timezone at UTC date boundary', () => {
  assert.equal(koreanDate(new Date('2026-09-27T22:30:00Z')), '2026-09-28');
});
test('HTTP error is not parsed as valid data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('blocked', { status: 403 }));
  await assert.rejects(checkedFetch('https://example.com'), /HTTP 403/);
});
test('market failures preserve observations, mark stale, and never invent neutral FGI', async t => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'market-data.json'), JSON.stringify({ fx: { price: 1350, change: 1 }, updatedAt: 'previous' }));
  t.mock.method(globalThis, 'fetch', async () => new Response('blocked', { status: 403 }));
  await fetchMarketSnapshot(dir);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'market-data.json'), 'utf8'));
  assert.equal(result.fx.price, 1350);
  assert.equal(result.fx.stale, true);
  assert.equal(result.fgi.price, null);
  assert.equal(result.updatedAt, 'previous');
});
