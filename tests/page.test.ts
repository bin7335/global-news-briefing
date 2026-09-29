import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vm from 'node:vm';

test('missing index cards do not stop rate/FGI updates; stale and null data are visible', async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const nodes = Object.fromEntries(['stat-fx', 'stat-us10y', 'stat-kr10y', 'stat-jp10y', 'stat-fgi', 'update-time', 'briefing-status', 'content'].map(id => [id, { innerHTML: '', innerText: '', textContent: '' }]));
  const quotes = { fx: { price: 1350, change: 0 }, nasdaq: { price: 27000 }, us10y: { price: 4.5, stale: true }, fgi: { price: null }, updatedAt: 'today', partial: true };
  vm.runInNewContext(scripts.at(-1)![1], {
    document: { getElementById: (id: string) => nodes[id] ?? null },
    fetch: async (url: string) => ({ ok: true, json: async () => quotes, text: async () => '# Report' }),
    marked: { parse: () => '<h1>Report</h1>' }, DOMPurify: { sanitize: (text: string) => text }, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes['stat-us10y'].innerHTML, /4.5%.*이전 값/);
  assert.equal(nodes['stat-fgi'].textContent, '--');
  assert.match(nodes['update-time'].innerText, /일부 지표 갱신 지연/);
  assert.equal(nodes.content.innerHTML, '<h1>Report</h1>');
});

test('freshness uses Korean broadcast date and does not relabel yesterday as today', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
  const context: any = { fetch: () => new Promise(() => {}), console };
  vm.createContext(context);
  vm.runInContext(script, context);
  const now = new Date('2026-09-29T00:00:00Z');
  assert.match(context.briefingFreshness('# 2026-09-29 Global News Briefing\n- 원본 영상: [09/28 당잠사]', now), /2026-09-28.*갱신 대기/);
  assert.match(context.briefingFreshness('# 2026-09-29 Global News Briefing\n- 원본 영상: [09/29 당잠사]', now), /오늘 브리핑$/);
  assert.match(context.briefingFreshness('# 2027-01-01 Global News Briefing\n- 원본 영상: [12/31 당잠사]', new Date('2027-01-01T00:00:00Z')), /2026-12-31.*갱신 대기/);
});
