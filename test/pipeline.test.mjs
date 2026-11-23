import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis } from '../src/pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', 'fixtures');

test('完整管线产出分读者报告，合作方之间互不可见', async () => {
  const analysis = await runAnalysis(folder, { runLabel: 'test-run' });
  assert.equal(analysis.manifest.runLabel, 'test-run');
  assert.ok(analysis.manifest.inputFingerprints['events.csv']);
  assert.equal(analysis.manifest.clockRevisions.length, 1);

  const [p1, p2] = analysis.reports.partnerWeekly;
  const p1Records = p1.signedExposures.map(r => r.record);
  const p2Records = p2.signedExposures.map(r => r.record);
  assert.ok(p1Records.includes('R1') && !p1Records.includes('R2'));
  assert.ok(p2Records.includes('R2') && !p2Records.includes('R1'));
  // P1 周报的任何字段都不得出现 P2 才有的记录或合作方编号
  assert.ok(!JSON.stringify(p1).includes('R2'));
  assert.equal(p1.visibility.includes('仅含本合作方'), true);
});

test('联合策展视图能同时看到跨线路证据与调入口效果', async () => {
  const analysis = await runAnalysis(folder);
  const curation = analysis.reports.curation;
  assert.ok(curation.entranceChanges.some(c => c.day === 2 && c.fromEntry === 'A' && c.toEntry === 'B'));
  assert.ok(curation.routeEffects.some(hall => hall.comparability.status === 'shared-traffic'));
  assert.ok(curation.journeyObservability.firstHallUnobserved.includes('V6|2'));
  assert.ok(curation.journeyObservability.scanGaps.length > 0);
});

test('管理员视图给出已履行/证据不足/待补偿三态与补偿清单', async () => {
  const analysis = await runAnalysis(folder);
  const admin = analysis.reports.admin;
  const statuses = new Set(admin.signedReconciliation.records.map(r => r.status));
  assert.ok(statuses.has('fulfilled'));
  assert.ok(statuses.has('insufficient'));
  assert.ok(statuses.has('pending'));
  assert.ok(admin.signedReconciliation.compensation.length > 0);
  assert.ok(admin.journeyQuality.duplicatePlayCount >= 1);
});

test('两轮资料指纹可用于定位输入变动，输出结构稳定', async () => {
  const first = await runAnalysis(folder);
  const second = await runAnalysis(folder);
  assert.deepEqual(first.manifest.inputFingerprints, second.manifest.inputFingerprints);
  const requiredKeys = [
    'manifest', 'dataQuality', 'journeySummary', 'entranceScopes',
    'routeEffects', 'exposureCredits', 'signedReconciliation', 'scheduling', 'reports', 'journeys',
  ];
  for (const key of requiredKeys) assert.ok(key in first, `缺少输出段 ${key}`);
});
