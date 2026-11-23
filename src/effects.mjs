// 导览线路对“后续实体展厅参观”的效果比较。
//
// 线路 = 旅程中第一条合格导览播放所在的终端（连同入口、讲解版本）。
// 后续实体参观 = 该旅程中发生在首条合格导览之后、且处于 active 扫描窗口内的 physical 事件。
//
// 独立参照规则：对某个实体厅，如果一条参照线路的旅程本身被另一条线路引导过
// （旅程内出现跨终端/跨入口段落，即共同流量），该参照不独立；扫描失效窗口内的
// 参观观察不到，只能计入观测限制，不能当作“没参观”。
// 比较结果带 comparability 判定与观测限制（调入口日期、讲解版本、共同流量、跟团记录）。

function routeOf(journey) {
  const first = journey.segments.find(s => s.kind === 'guide' && s.meetsContentThreshold === true);
  if (!first) return null;
  return {
    terminal: first.terminal,
    entry: first.entry,
    hall: first.hall,
    edition: first.edition,
    minute: first.minute,
  };
}

/** 旅程内出现过的导览终端集合；多于一个即跨线路共同流量 */
function routeTerminalsVisited(journey) {
  return [...new Set(journey.segments.filter(s => s.kind === 'guide').map(s => s.terminal))].sort();
}

export function routeEffects(journeys, entranceChanges, data) {
  const changeDays = new Set(entranceChanges.map(c => c.day));
  const physicalHalls = [...new Set(
    journeys.flatMap(j => j.segments.filter(s => s.kind === 'physical').map(s => s.hall)),
  )].sort();

  const routed = journeys
    .filter(j => !j.includesStaff)
    .map(journey => ({ journey, route: routeOf(journey), terminals: routeTerminalsVisited(journey) }))
    .filter(item => item.route !== null);

  const terminalSet = [...new Set(routed.map(item => item.route.terminal))].sort();

  const results = physicalHalls.map(hall => {
    // 哪些线路的导览段落直接引导过该厅（共同流量的来源证据）
    const guidingTerminals = [...new Set(routed.flatMap(item =>
      item.journey.segments
        .filter(s => s.kind === 'guide' && s.hall === hall)
        .map(() => item.route.terminal),
    ))].sort();

    const routeGroups = terminalSet.map(terminal => {
      const members = routed.filter(item => item.route.terminal === terminal);
      let laterPhysicalVisits = 0;
      let unobservedEvents = 0;
      let crossRouteMembers = 0;
      let groupJourneys = 0;
      const editions = new Set();

      for (const { journey, route, terminals } of members) {
        editions.add(route.edition);
        if (journey.kind === 'group') groupJourneys += 1;
        if (terminals.length > 1) crossRouteMembers += 1;
        const later = journey.segments.filter(s =>
          s.kind === 'physical' && s.hall === hall && s.minute >= route.minute);
        if (later.some(s => s.observed)) laterPhysicalVisits += 1;
        unobservedEvents += later.filter(s => !s.observed).length;
      }

      return {
        terminal,
        entry: members[0]?.route.entry ?? null,
        editions: [...editions].filter(Boolean).sort(),
        journeys: members.length,
        groupJourneys,
        crossRouteJourneys: crossRouteMembers,
        laterPhysicalVisits,
        unobservedEvents,
        changeDayJourneys: members.filter(({ journey }) => changeDays.has(journey.day)).length,
        conversionRate: members.length === 0 ? 0 : Number((laterPhysicalVisits / members.length).toFixed(4)),
        groupShare: members.length === 0 ? 0 : Number((groupJourneys / members.length).toFixed(4)),
      };
    });

    const sharedTraffic = routeGroups.some(g => g.crossRouteJourneys > 0) || guidingTerminals.length > 1;
    let comparability;
    if (routeGroups.filter(g => g.journeys > 0).length < 2) {
      comparability = {
        status: 'no-comparison',
        independentReference: false,
        reason: '该实体厅只有一条线路有合格导览样本，无法形成线路间比较',
      };
    } else if (sharedTraffic) {
      comparability = {
        status: 'shared-traffic',
        independentReference: false,
        reason: `展厅 ${hall} 存在跨线路引导或跨终端旅程（${guidingTerminals.join('、') || '旅程内多终端'}），参照线路不独立`,
        guidingTerminals,
      };
    } else {
      comparability = {
        status: 'comparable',
        independentReference: true,
        reason: '各线路旅程未出现跨线路引导，未引导该厅的线路可作为独立参照',
        guidingTerminals,
      };
    }

    return {
      hall,
      sharedTraffic,
      guidingTerminals,
      comparability,
      routeGroups,
      observationLimits: {
        entranceChangeDays: [...changeDays].sort(),
        hasGroupRecords: routeGroups.some(g => g.groupJourneys > 0),
        unobservedEvents: routeGroups.reduce((sum, g) => sum + g.unobservedEvents, 0),
      },
    };
  });

  return {
    halls: results,
    scanGaps: data.physicalScan
      .filter(scan => scan.status === 'unobserved')
      .map(scan => ({ day: scan.day, terminal: scan.terminal, hall: scan.hall, window: scan.window })),
  };
}
