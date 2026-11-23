// 各入口“可观察到的旅程”与“可归属范围”是两件事：
// - 可观察：旅程中的导览段落经布局解析落在该入口服务的终端上；
// - 可归属：票域首见时点可观察且入口未停用，才允许归到票载入口。
// 首厅观察不到或入口已停用的旅程只进可观察集合，不进入归属计数。

function staffIncluded(journey, includeStaff) {
  return includeStaff || !journey.includesStaff;
}

export function entranceScopes(journeys, { includeStaff = false } = {}) {
  const scopes = new Map();
  const ensure = entry => {
    if (!scopes.has(entry)) {
      scopes.set(entry, {
        entry,
        observableJourneys: [],
        attributableJourneys: [],
        unobservableFirstHall: [],
        inactiveEntry: [],
      });
    }
    return scopes.get(entry);
  };

  for (const journey of journeys) {
    if (!staffIncluded(journey, includeStaff)) continue;

    for (const entry of journey.entriesObserved) {
      ensure(entry).observableJourneys.push(journey.journeyId);
    }

    if (journey.attribution.state === 'attributed') {
      ensure(journey.attribution.entry).attributableJourneys.push(journey.journeyId);
    } else if (journey.attribution.state === 'first-hall-unobserved') {
      // 票载入口仍能“看到”该旅程的部分段落，但归属范围必须排除
      ensure(journey.ticketEntry).unobservableFirstHall.push(journey.journeyId);
    } else if (journey.attribution.state === 'entry-inactive') {
      ensure(journey.attribution.entry).inactiveEntry.push(journey.journeyId);
    }
  }

  return [...scopes.values()]
    .map(scope => ({
      entry: scope.entry,
      observableCount: scope.observableJourneys.length,
      attributableCount: scope.attributableJourneys.length,
      effectiveAttributable: scope.attributableJourneys
        .filter(id => journeys.find(j => j.journeyId === id)?.effectiveVisit).length,
      unobservableFirstHall: scope.unobservableFirstHall,
      inactiveEntry: scope.inactiveEntry,
      observableJourneys: [...scope.observableJourneys].sort(),
      attributableJourneys: [...scope.attributableJourneys].sort(),
    }))
    .sort((a, b) => a.entry.localeCompare(b.entry));
}

/** 按日 × 入口的有效参观汇总（团体计 1 次，工作人员默认排除）。 */
export function dailyEntranceTotals(journeys, { includeStaff = false } = {}) {
  const rows = new Map();
  const bump = (day, entry, field, weight = 1) => {
    const key = `${day}|${entry}`;
    if (!rows.has(key)) rows.set(key, { day, entry, visits: 0, effectiveVisits: 0, effectiveGuide: 0, effectivePhysical: 0, parties: 0, people: 0 });
    const row = rows.get(key);
    row[field] += weight;
  };

  for (const journey of journeys) {
    if (!staffIncluded(journey, includeStaff)) continue;
    if (journey.attribution.state !== 'attributed') continue;
    const { day } = journey;
    const entry = journey.attribution.entry;
    bump(day, entry, 'visits');
    bump(day, entry, 'parties');
    bump(day, entry, 'people', journey.partySize);
    if (journey.effectiveGuide) bump(day, entry, 'effectiveGuide');
    if (journey.effectivePhysical) bump(day, entry, 'effectivePhysical');
    if (journey.effectiveVisit) bump(day, entry, 'effectiveVisits');
  }

  return [...rows.values()].sort((a, b) => a.day - b.day || a.entry.localeCompare(b.entry));
}
