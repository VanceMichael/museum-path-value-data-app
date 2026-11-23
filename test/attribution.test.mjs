import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/load.mjs';
import { buildSegments, buildJourneys } from '../src/journeys.mjs';
import { entranceScopes, dailyEntranceTotals } from '../src/attribution.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', 'fixtures');

async function setup() {
  const data = await loadData(folder);
  const result = buildJourneys(data, buildSegments(data));
  return { data, ...result };
}

test('可观察范围大于可归属范围：未观察首厅的旅程只在前者出现', async () => {
  const { journeys } = await setup();
  const scopes = entranceScopes(journeys);
  const scopeA = scopes.find(s => s.entry === 'A');
  assert.ok(scopeA.observableCount >= scopeA.attributableCount);
  assert.ok(scopeA.unobservableFirstHall.includes('V6|2'));
  assert.ok(!scopeA.attributableJourneys.includes('V6|2'));
});

test('停用入口不得接收归属：首见落在关闭通知内的票域标记为 entry-inactive', async () => {
  const data = await loadData(folder);
  // 把 V1 的票域挪到 day4，首见 09:05 落在 A 入口关闭通知 N1 内，事件同步改到 day4
  const ticket = data.ticketByVisit.get('V1');
  ticket.day = 4;
  ticket.entry = 'A';
  ticket.firstSeen = 545;
  for (const event of data.events.filter(e => e.visit === 'V1')) event.day = 4;
  // day4 需要有 T1 的布局承接播放，否则段落不在布局内；补一条
  data.layout.push({ day: 4, entry: 'A', terminal: 'T1', hall: 'H1', window: [540, 600], language: 'zh', assist: true });
  data.editions.push({ terminal: 'T1', content: 'C1', day: 4, window: [540, 600], edition: 'v2', language: 'zh' });

  const result = buildJourneys(data, buildSegments(data));
  const v1 = result.journeys.find(j => j.journeyId === 'V1|4');
  assert.equal(v1.attribution.state, 'entry-inactive');
  assert.equal(v1.attribution.entry, 'A');

  const { entryOpenAt } = await import('../src/context.mjs');
  assert.equal(entryOpenAt(data, { day: 4, entry: 'A', minute: 545 }).open, false);
  assert.equal(entryOpenAt(data, { day: 4, entry: 'A', minute: 555 }).open, true);
  assert.equal(entryOpenAt(data, { day: 4, entry: 'B', minute: 545 }).open, true);
});

test('每日入口汇总只统计可归属旅程，团体计 1 次', async () => {
  const { journeys } = await setup();
  const totals = dailyEntranceTotals(journeys);
  const day2 = totals.filter(row => row.day === 2);
  for (const row of day2) {
    assert.ok(row.visits >= row.effectiveVisits);
    assert.equal(row.people >= row.visits, true); // 人数仅作证据解释
  }
  assert.ok(!totals.some(row => JSON.stringify(row).includes('V6')));
});
