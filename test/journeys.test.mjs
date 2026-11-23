import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/load.mjs';
import { buildSegments, buildJourneys, detectEntranceChanges } from '../src/journeys.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', 'fixtures');

async function setup() {
  const data = await loadData(folder);
  const segments = buildSegments(data);
  const result = buildJourneys(data, segments);
  return { data, ...result };
}

test('同一票域、内容、开始时点的重复播放只计一次（E4/E5 误重复上报）', async () => {
  const { duplicateEvents, journeys } = await setup();
  assert.deepEqual(duplicateEvents.map(d => d.eventId), ['E5']);
  assert.equal(duplicateEvents[0].canonicalId, 'E4');
  const v2 = journeys.find(j => j.journeyId === 'V2|1');
  assert.equal(v2.counts.guidePlays, 1); // 65 秒播放只算一段
});

test('touch 误触不产生旅程段落，不能增加有效参观', async () => {
  const { touchEvents, journeys } = await setup();
  assert.ok(touchEvents >= 1);
  const v1 = journeys.find(j => j.journeyId === 'V1|1');
  assert.deepEqual(v1.segments.map(s => s.eventId), ['E2', 'E3']); // E1 touch 被忽略
});

test('工作人员旅程单独标记，不计入公众有效参观汇总', async () => {
  const { journeys } = await setup();
  const staff = journeys.find(j => j.journeyId === 'V3|1');
  assert.equal(staff.includesStaff, true);
  assert.equal(staff.kind, 'staff');
});

test('团体按 1 次参观计，party_size 只作证据解释', async () => {
  const { journeys } = await setup();
  const group = journeys.find(j => j.journeyId === 'V2|1');
  assert.equal(group.kind, 'group');
  assert.equal(group.partySize, 6); // 不展开成 6 次
});

test('first_seen 缺失时首厅不可观察，旅程不硬归属但仍保留在可观察集合', async () => {
  const { journeys } = await setup();
  const v6 = journeys.find(j => j.journeyId === 'V6|2');
  assert.equal(v6.attribution.state, 'first-hall-unobserved');
  assert.equal(v6.attribution.entry, null);
  assert.ok(v6.entriesObserved.length > 0); // 仍能看到它经过的入口/厅
});

test('扫描失效窗口内的实体参观不计有效，也不能当作没参观（V4 day2 09:55）', async () => {
  const { journeys } = await setup();
  const v4 = journeys.find(j => j.journeyId === 'V4|2');
  const gap = v4.observationGaps.find(g => g.eventId === 'E56');
  assert.equal(gap.reason, 'unobserved');
  // E7 在 T3 合格播放，但 E56 观察失效 → 实体有效参观不成立
  assert.equal(v4.effectiveGuide, true);
  assert.equal(v4.effectivePhysical, false);
  assert.equal(v4.effectiveVisit, false);
});

test('合格播放需达到内容秒数线（V2 的 65 秒对 C1 合格，短播放不合格）', async () => {
  const { journeys } = await setup();
  const v2 = journeys.find(j => j.journeyId === 'V2|1');
  assert.equal(v2.effectiveGuide, true);
  const shortPlay = journeys
    .flatMap(j => j.segments)
    .find(s => s.eventId === 'Q14'); // 20 秒，C2 线 90
  assert.equal(shortPlay.meetsContentThreshold, false);
});

test('识别 day2 T1 由 A 切换到 B 的调入口时点', async () => {
  const { data } = await setup();
  const changes = detectEntranceChanges(data);
  assert.deepEqual(changes, [{
    day: 2, terminal: 'T1', atMinute: 560, at: '09:20',
    fromEntry: 'A', toEntry: 'B',
  }]);
});
