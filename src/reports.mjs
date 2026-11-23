// 面向不同读者的报告视图：
// - 合作方周报：仅显示本合作方约定内容的合格曝光、已签记录核对与可信度，看不到对方明细；
// - 联合策展视图：跨线路证据、调入口效果、独立参照判定；
// - 管理员视图：全部入口归属、排期计划、补偿清单与时钟修订影响。

import { toHHMM } from './time.mjs';

/**
 * 可信度分级（每个合作方/内容）：
 * - high：已履行时段均有当前校准下的直接事件证据，且无未观察窗口影响其内容；
 * - medium：存在共享时段按权重折算，或部分证据落在调入口日期附近；
 * - low：存在再校准后失效、证据不足待补偿，或扫描失效窗口覆盖相关实体厅。
 */
function confidenceFor(partner, content, reconciliation, effects) {
  const records = reconciliation.records.filter(r => r.partner === partner && r.content === content);
  const reasons = [];
  let level = 'high';

  if (records.some(r => r.status === 'insufficient')) {
    level = 'low';
    reasons.push('存在证据不足/再校准后失效的已签时段');
  }
  if (reconciliation.clockRevisions.length > 0) {
    if (level !== 'low') level = 'medium';
    reasons.push('期间发生时钟再校准，历史时点需结合签发依据阅读');
  }
  if (records.some(r => r.clockImpact)) {
    level = 'low';
    reasons.push('该合作方有证据事件直接受时钟修订影响');
  }
  if (effects.scanGaps.length > 0) {
    if (level === 'high') level = 'medium';
    reasons.push('实体厅存在扫描失效窗口，后续参观证据不完整');
  }
  if (reasons.length === 0) reasons.push('全部合格时段均有当前校准下的直接事件证据');
  return { level, reasons };
}

export function partnerWeeklyReports(context) {
  const { data, credits, reconciliation, effects } = context;
  return data.contracts.map(contract => {
    const weekly = credits.weekly.find(w => w.partner === contract.partner && w.content === contract.content);
    const ownRecords = reconciliation.records
      .filter(r => r.partner === contract.partner && r.content === contract.content)
      .map(r => ({
        record: r.record,
        day: r.day,
        window: r.signedWindow,
        entry: r.entry,
        status: r.status,
        headline: r.headline,
        compensable: r.compensable,
        evidenceEvent: r.evidenceEvent,
        basisAtIssue: { qualified: r.basisAtIssue?.qualified, minute: r.basisAtIssue?.minuteLabel },
        currentView: { qualified: r.currentView.qualified, minute: r.currentView.minuteLabel, reasons: r.currentView.reasons },
      }));
    return {
      partner: contract.partner,
      scope: { content: contract.content, languages: contract.languages, terminal: contract.sharedTerminal },
      contract: {
        requiredSlots: contract.requiredSlots,
        qualifiedMinSeconds: contract.qualifiedMinSeconds,
        observedSlots: weekly.observedSlots,
        remainingSlots: weekly.remainingSlots,
        sharedSlots: weekly.sharedSlots,
        byDay: weekly.byDay,
      },
      signedExposures: ownRecords,
      confidence: confidenceFor(contract.partner, contract.content, reconciliation, effects),
      // 显式声明不可见范围
      visibility: '仅含本合作方约定内容；其他合作方明细、跨线路个人旅程不可见',
    };
  });
}

export function curationReport(context) {
  const { entranceTotals, entranceScopes, effects, entranceChanges, journeys } = context;
  return {
    entranceChanges,
    dailyEntranceTotals: entranceTotals,
    entranceScopes: entranceScopes.map(scope => ({
      entry: scope.entry,
      observableCount: scope.observableCount,
      attributableCount: scope.attributableCount,
      effectiveAttributable: scope.effectiveAttributable,
      unobservableFirstHall: scope.unobservableFirstHall,
      inactiveEntry: scope.inactiveEntry,
    })),
    routeEffects: effects.halls.map(hall => ({
      hall: hall.hall,
      sharedTraffic: hall.sharedTraffic,
      comparability: hall.comparability,
      routeGroups: hall.routeGroups,
      observationLimits: hall.observationLimits,
    })),
    journeyObservability: {
      firstHallUnobserved: journeys.filter(j => j.attribution.state === 'first-hall-unobserved').map(j => j.journeyId),
      inactiveEntry: journeys.filter(j => j.attribution.state === 'entry-inactive').map(j => j.journeyId),
      scanGaps: effects.scanGaps.map(gap => ({
        day: gap.day, terminal: gap.terminal, hall: gap.hall,
        from: toHHMM(gap.window[0]), to: toHHMM(gap.window[1]),
      })),
    },
  };
}

export function adminReport(context) {
  const { reconciliation, scheduling, dedupe, journeySummary } = context;
  return {
    journeyQuality: { ...dedupe, ...journeySummary },
    signedReconciliation: {
      records: reconciliation.records,
      compensation: reconciliation.compensation,
      clockRevisions: reconciliation.clockRevisions,
    },
    scheduling,
    dispositionLegend: {
      fulfilled: '已履行：当前校准下证据仍满足合格口径',
      insufficient: '证据不足：签发依据或最新记录不满足，需补偿',
      pending: '待履行：仅排期，尚无实绩',
    },
  };
}
