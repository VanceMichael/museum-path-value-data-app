import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/load.mjs';
import { buildSegments, buildJourneys } from '../src/journeys.mjs';
import { observedExposureCredits, reconcileSigned } from '../src/exposures.mjs';
import { correctedMinute, minuteAsOf, clockRevisions } from '../src/clock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', 'fixtures');

async function setup() {
  const data = await loadData(folder);
  const journeyResult = buildJourneys(data, buildSegments(data));
  return { data, journeyResult };
}

test('时钟再校准：E8 在签发日按旧值是 09:22，校准后按新值是 09:19', async () => {
  const { data } = await setup();
  const event = data.eventById.get('E8');
  assert.equal(event.recordedMinute, 562); // 09:22
  assert.equal(minuteAsOf(event, data.offsets, 2), 562); // known_day=2 时 seconds_add=0
  assert.equal(correctedMinute(event, data.offsets), 559); // -180 秒 → 09:19
  const revisions = clockRevisions(data.offsets);
  assert.deepEqual(revisions.map(r => `${r.terminal}|${r.day}`), ['T1|2']);
  assert.equal(revisions[0].shiftedMinutes, -3);
});

test('R1 保留签发依据，且按新记录判定证据不足、可补偿', async () => {
  const { data } = await setup();
  const reconciliation = reconcileSigned(data);
  const r1 = reconciliation.records.find(r => r.record === 'R1');
  assert.equal(r1.basisAtIssue.qualified, true);
  assert.equal(r1.basisAtIssue.entryAtTime, 'B');
  assert.equal(r1.currentView.qualified, false);
  assert.ok(r1.currentView.reasons.some(reason => reason.includes('约定窗口')));
  assert.equal(r1.currentView.entryAtTime, 'A');
  assert.equal(r1.status, 'insufficient');
  assert.equal(r1.compensable, true);
  assert.ok(reconciliation.compensation.flatMap(c => c.compensableRecords).includes('R1'));
});

test('R2 不受修订影响，签发与当前视图都合格，判 fulfilled', async () => {
  const { data } = await setup();
  const r2 = reconcileSigned(data).records.find(r => r.record === 'R2');
  assert.equal(r2.basisAtIssue.qualified, true);
  assert.equal(r2.currentView.qualified, true);
  assert.equal(r2.status, 'fulfilled');
});

test('scheduled 记录没有实绩，判 pending 且不产生补偿', async () => {
  const { data } = await setup();
  const reconciliation = reconcileSigned(data);
  for (const record of ['R3', 'R4']) {
    const row = reconciliation.records.find(r => r.record === record);
    assert.equal(row.status, 'pending');
    assert.equal(row.compensable, false);
  }
});

test('合格时段按合约口径累计，秒数不达标播放不产生信用', async () => {
  const { data, journeyResult } = await setup();
  const credits = observedExposureCredits(data, journeyResult);
  const p1 = credits.weekly.find(w => w.partner === 'P1');
  assert.equal(p1.requiredSlots, 2);
  assert.ok(p1.observedSlots >= 1);
  // 每个信用都能回溯到具体事件
  for (const detail of credits.slotDetails) {
    assert.ok(typeof detail.evidenceEvent === 'string');
    assert.ok(detail.credit > 0 && detail.credit <= 1);
  }
});

test('共享屏幕同一时段按权重拆分，任何一方都不得记整段', async () => {
  const data = await loadData(folder);
  // 构造同一 20 分钟网格内 P1/C1 与 P2/C2 都合格的共享时段
  data.events.push(
    { id: 'Z1', rowIndex: 99, visit: 'V1', terminal: 'T1', day: 1, recordedMinute: 570, type: 'play', content: 'C1', seconds: 90 },
    { id: 'Z2', rowIndex: 100, visit: 'V2', terminal: 'T1', day: 1, recordedMinute: 571, type: 'play', content: 'C2', seconds: 95 },
  );
  data.editions.push({ terminal: 'T1', content: 'C2', day: 1, window: [540, 600], edition: 'v1', language: 'zh' });
  const journeyResult = buildJourneys(data, buildSegments(data));
  const credits = observedExposureCredits(data, journeyResult);
  const slot = credits.slotDetails.find(d => d.day === 1 && d.slotStart === '09:20');
  assert.equal(slot.shared, true);
  const weights = credits.slotDetails
    .filter(d => d.day === 1 && d.slotStart === '09:20')
    .reduce((sum, d) => sum + d.credit, 0);
  assert.equal(Number(weights.toFixed(2)), 1); // 0.6 + 0.4
});
