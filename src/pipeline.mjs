// 一轮分析的主入口：加载新一轮匿名事件与票务卷 → 重建旅程 → 入口归属 →
// 线路效果 → 曝光核算与已签核对 → 候选排期 → 分读者报告。
// 每次有新资料目录即可重跑；输出含输入指纹，便于比对两次运行间的变动。
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { loadData } from './load.mjs';
import { buildSegments, buildJourneys, detectEntranceChanges } from './journeys.mjs';
import { entranceScopes, dailyEntranceTotals } from './attribution.mjs';
import { routeEffects } from './effects.mjs';
import { observedExposureCredits, reconcileSigned } from './exposures.mjs';
import { buildPlans } from './scheduling.mjs';
import { partnerWeeklyReports, curationReport, adminReport } from './reports.mjs';

async function fingerprint(folder) {
  const names = (await readdir(folder)).filter(name => name.endsWith('.csv') || name === 'format.json').sort();
  const hashes = {};
  for (const name of names) {
    const content = await readFile(join(folder, name));
    hashes[name] = createHash('sha256').update(content).digest('hex').slice(0, 12);
  }
  return hashes;
}

function summarizeJourneys(journeyResult) {
  const publicJourneys = journeyResult.journeys.filter(j => !j.includesStaff);
  return {
    totalJourneys: journeyResult.journeys.length,
    publicJourneys: publicJourneys.length,
    staffJourneys: journeyResult.journeys.filter(j => j.includesStaff).length,
    groupJourneys: publicJourneys.filter(j => j.kind === 'group').length,
    effectiveGuide: publicJourneys.filter(j => j.effectiveGuide).length,
    effectivePhysical: publicJourneys.filter(j => j.effectivePhysical).length,
    effectiveVisits: publicJourneys.filter(j => j.effectiveVisit).length,
    attributionBreakdown: {
      attributed: publicJourneys.filter(j => j.attribution.state === 'attributed').length,
      firstHallUnobserved: publicJourneys.filter(j => j.attribution.state === 'first-hall-unobserved').length,
      entryInactive: publicJourneys.filter(j => j.attribution.state === 'entry-inactive').length,
    },
  };
}

export async function runAnalysis(folder, { runLabel = new Date().toISOString() } = {}) {
  const data = await loadData(folder);
  const segmentResult = buildSegments(data);
  const journeyResult = buildJourneys(data, segmentResult);
  const entranceChanges = detectEntranceChanges(data);

  const scopes = entranceScopes(journeyResult.journeys);
  const totals = dailyEntranceTotals(journeyResult.journeys);
  const effects = routeEffects(journeyResult.journeys, entranceChanges, data);
  const credits = observedExposureCredits(data, journeyResult);
  const reconciliation = reconcileSigned(data);
  const scheduling = buildPlans(data, credits, credits.weekly);

  const dedupe = {
    duplicatePlayEvents: journeyResult.duplicateEvents,
    duplicatePlayCount: journeyResult.duplicateEvents.length,
    touchEventsIgnored: journeyResult.touchEvents,
    orphanEvents: journeyResult.orphanEvents,
  };
  const journeySummary = summarizeJourneys(journeyResult);

  const context = {
    data,
    journeyResult,
    journeys: journeyResult.journeys,
    entranceChanges,
    entranceScopes: scopes,
    entranceTotals: totals,
    effects,
    credits,
    reconciliation,
    scheduling,
    dedupe,
    journeySummary,
  };

  const result = {
    manifest: {
      runLabel,
      sourceFolder: basename(folder),
      inputFingerprints: await fingerprint(folder),
      clockRevisions: reconciliation.clockRevisions,
    },
    dataQuality: dedupe,
    journeySummary,
    entranceChanges,
    entranceScopes: scopes,
    dailyEntranceTotals: totals,
    routeEffects: effects,
    exposureCredits: { weekly: credits.weekly, slotDetails: credits.slotDetails },
    signedReconciliation: reconciliation,
    scheduling,
    reports: {
      partnerWeekly: partnerWeeklyReports(context),
      curation: curationReport(context),
      admin: adminReport(context),
    },
    journeys: journeyResult.journeys.map(journey => ({
      journeyId: journey.journeyId,
      day: journey.day,
      kind: journey.kind,
      ticketEntry: journey.ticketEntry,
      attribution: journey.attribution,
      entriesObserved: journey.entriesObserved,
      hallsObserved: journey.hallsObserved,
      counts: journey.counts,
      effectiveGuide: journey.effectiveGuide,
      effectivePhysical: journey.effectivePhysical,
      physicalAfterGuide: journey.physicalAfterGuide,
      effectiveVisit: journey.effectiveVisit,
      observationGaps: journey.observationGaps,
    })),
  };

  return result;
}
