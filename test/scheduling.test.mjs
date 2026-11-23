import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/load.mjs';
import { buildSegments, buildJourneys, detectEntranceChanges } from '../src/journeys.mjs';
import { observedExposureCredits } from '../src/exposures.mjs';
import { buildPlans } from '../src/scheduling.mjs';
import { routeEffects } from '../src/effects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', 'fixtures');

async function setup() {
  const data = await loadData(folder);
  const journeyResult = buildJourneys(data, buildSegments(data));
  const credits = observedExposureCredits(data, journeyResult);
  return { data, journeyResult, credits };
}

test('S1 与 S2 同屏幕并行占用必须报冲突，可行计划里不同时出现', async () => {
  const { data, credits } = await setup();
  const scheduling = buildPlans(data, credits, credits.weekly);
  assert.ok(scheduling.conflicts.some(c =>
    c.type === 'terminal-overlap' && c.between.join('|') === 'S1|S2'));
  for (const plan of scheduling.plans) {
    assert.ok(!(plan.options.includes('S1') && plan.options.includes('S2')));
  }
});

test('同一辅助设备不能在重叠时段同时服务 T1 与 T3', async () => {
  const { data, credits } = await setup();
  const scheduling = buildPlans(data, credits, credits.weekly);
  const deviceConflicts = scheduling.conflicts.filter(c => c.type === 'assist-device-overlap');
  assert.ok(deviceConflicts.some(c => c.device === 'D01'));
  for (const plan of scheduling.plans) {
    assert.ok(!(plan.options.includes('S1') && plan.options.includes('S3')));
  }
});

test('S1 覆盖 A 入口临时关闭窗口，必须显式列出关闭风险且可用时段被说明', async () => {
  const { data, credits } = await setup();
  const scheduling = buildPlans(data, credits, credits.weekly);
  const s1 = scheduling.options.find(o => o.option === 'S1');
  assert.ok(s1.closureRisks.some(risk => risk.entry === 'A' && risk.minutes === 10));
});

test('无障碍设备清单覆盖正在开放入口的终端，缺口在报告中可见', async () => {
  const { data, credits } = await setup();
  const scheduling = buildPlans(data, credits, credits.weekly);
  assert.deepEqual(scheduling.assistCoverage.openEntries.sort(), ['A', 'B']);
  assert.ok(scheduling.assistCoverage.assistRequiredTerminals.includes('T1'));
  assert.ok(scheduling.assistCoverage.equipment.some(e => e.device === 'D01'));
});

test('推荐计划按承诺覆盖与估算信用排序，且所有计划给出承诺覆盖明细', async () => {
  const { data, credits } = await setup();
  const scheduling = buildPlans(data, credits, credits.weekly);
  assert.ok(scheduling.plans.length >= 3);
  assert.equal(scheduling.recommended.options.join('|'), scheduling.plans[0].options.join('|'));
  for (const plan of scheduling.plans) {
    for (const commitment of plan.commitmentCoverage) {
      assert.ok('covered' in commitment && 'remainingSlots' in commitment);
    }
  }
});

test('跨终端旅程使实体厅参照不独立；扫描失效计入观测限制而非零参观', async () => {
  const { data, journeyResult } = await setup();
  const effects = routeEffects(journeyResult.journeys, detectEntranceChanges(data), data);
  const h2 = effects.halls.find(h => h.hall === 'H2');
  assert.equal(h2.comparability.independentReference, false);
  assert.ok(h2.routeGroups.some(g => g.conversionRate > 0)); // 不是全 0
  assert.ok(h2.observationLimits.unobservedEvents >= 1);
  assert.ok(effects.scanGaps.some(gap => gap.day === 2 && gap.hall === 'H2'));
});
