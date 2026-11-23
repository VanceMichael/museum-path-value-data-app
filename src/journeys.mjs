// 旅程重建与有效参观判定。
//
// 关键口径（来自交接说明）：
// - 票务键只在同一 visit 与日号内表示匿名旅程，party 跨日不代表同人；
// - 公用屏可能记录同一组旅程的几段事件，按 (visit, day) 串联；
// - 相同票域、内容、相同开始时点的重复上报只是同一播放，去重后只计一次；
// - touch 是误触/点选，不产生听讲，不能增加有效参观；
// - 工作人员(kind=staff)旅程单独呈现，不计入对公众的有效参观；
// - 团体按 1 次有效参观计，party_size 仅用于证据解释，不反查个人。

import { correctedMinute } from './clock.mjs';
import { layoutAt, editionAt, scanCoverageAt, entryOpenAt } from './context.mjs';
import { toHHMM } from './time.mjs';

function contentThresholds(contracts) {
  const map = new Map();
  for (const contract of contracts) {
    const current = map.get(contract.content);
    if (current === undefined || contract.qualifiedMinSeconds < current) {
      map.set(contract.content, contract.qualifiedMinSeconds);
    }
  }
  return map;
}

/**
 * 事件去重与上下文挂载。
 * 重复播放键：同一 visit + 终端 + 日 + 内容 + 终端记录开始时点（校准前的时点，
 * 因为重复上报来自同一终端时钟）。
 */
export function buildSegments(data) {
  const thresholds = contentThresholds(data.contracts);
  const seenPlays = new Map();
  const segments = [];
  const duplicateEvents = [];
  let touchEvents = 0;
  let orphanEvents = 0;

  for (const event of [...data.events].sort((a, b) =>
    a.day - b.day || a.recordedMinute - b.recordedMinute || a.id.localeCompare(b.id))) {
    const ticket = data.ticketByVisit.get(event.visit);
    if (!ticket || ticket.day !== event.day) {
      orphanEvents += 1; // 票域无法在当日匹配，不并入任何旅程
      continue;
    }
    const minute = correctedMinute(event, data.offsets);

    if (event.type === 'touch') {
      touchEvents += 1;
      continue; // 误触不产生旅程段落
    }

    if (event.type === 'play') {
      const dedupeKey = [event.visit, event.terminal, event.day, event.content, event.recordedMinute].join('|');
      const canonical = seenPlays.get(dedupeKey);
      if (canonical) {
        duplicateEvents.push({ eventId: event.id, canonicalId: canonical, key: dedupeKey });
        continue; // 同一播放的重复上报，丢弃
      }
      const layout = layoutAt(data, { day: event.day, terminal: event.terminal, minute });
      const edition = editionAt(data, {
        day: event.day, terminal: event.terminal, content: event.content, minute,
      });
      const open = layout
        ? entryOpenAt(data, { day: event.day, entry: layout.entry, minute })
        : { open: false, assumed: false, notice: null };
      const threshold = thresholds.get(event.content);
      const segment = {
        eventId: event.id,
        visit: event.visit,
        day: event.day,
        kind: 'guide',
        terminal: event.terminal,
        recordedMinute: event.recordedMinute,
        minute,
        seconds: event.seconds,
        content: event.content,
        entry: layout?.entry ?? null,
        hall: layout?.hall ?? null,
        languageMatched: layout ? editionAt(data, {
          day: event.day, terminal: event.terminal, content: event.content, minute,
        })?.language === layout.language : false,
        assist: layout?.assist ?? false,
        edition: edition?.edition ?? null,
        editionLanguage: edition?.language ?? null,
        withinLayout: Boolean(layout),
        entryOpen: open.open,
        entryNoticeAssumed: open.assumed,
        meetsContentThreshold: threshold === undefined ? null : event.seconds >= threshold,
        thresholdSeconds: threshold ?? null,
      };
      seenPlays.set(dedupeKey, event.id);
      segments.push(segment);
      continue;
    }

    if (event.type === 'physical') {
      const hall = event.content; // physical 事件的 content 字段承载实体厅编号
      const coverage = scanCoverageAt(data, {
        day: event.day, terminal: event.terminal, hall, minute,
      });
      segments.push({
        eventId: event.id,
        visit: event.visit,
        day: event.day,
        kind: 'physical',
        terminal: event.terminal,
        recordedMinute: event.recordedMinute,
        minute,
        seconds: event.seconds,
        hall,
        observed: coverage.observed,
        observeReason: coverage.reason,
      });
    }
  }

  return { segments, duplicateEvents, touchEvents, orphanEvents };
}

/** 按 (visit, day) 把段落串成匿名旅程并做有效性与归属判定。 */
export function buildJourneys(data, segmentResult) {
  const { segments, duplicateEvents, touchEvents, orphanEvents } = segmentResult;
  const byJourney = new Map();

  for (const segment of segments) {
    const key = `${segment.visit}|${segment.day}`;
    if (!byJourney.has(key)) byJourney.set(key, []);
    byJourney.get(key).push(segment);
  }

  const journeys = [];
  for (const [key, segs] of byJourney) {
    const [visit, dayPart] = key.split('|');
    const day = Number(dayPart);
    const ticket = data.ticketByVisit.get(visit);
    const ordered = [...segs].sort((a, b) => a.minute - b.minute || a.eventId.localeCompare(b.eventId));
    const guideSegs = ordered.filter(s => s.kind === 'guide');
    const physicalSegs = ordered.filter(s => s.kind === 'physical');
    const observedPhysical = physicalSegs.filter(s => s.observed);

    const qualifiedPlays = guideSegs.filter(s => s.meetsContentThreshold === true && s.withinLayout && s.entryOpen);
    const firstQualified = qualifiedPlays[0] ?? null;
    const firstObservedPhysical = observedPhysical[0] ?? null;

    const effectiveGuide = qualifiedPlays.length > 0;
    const effectivePhysical = observedPhysical.length > 0;
    const physicalAfterGuide = Boolean(
      firstQualified && firstObservedPhysical
      && firstObservedPhysical.minute >= firstQualified.minute,
    );
    const effectiveVisit = effectiveGuide && effectivePhysical;

    // 入口归属：first_seen 缺失=首厅观察不到，不能当作没经过，但也不能硬归到某个入口；
    // first_seen 存在但该入口在首见时点已停用，旅程不得归到停用入口。
    let attribution;
    if (ticket.firstSeen === null) {
      attribution = { state: 'first-hall-unobserved', entry: null, reason: 'ticket 缺少 first_seen，首厅不可观察' };
    } else {
      const open = entryOpenAt(data, { day, entry: ticket.entry, minute: ticket.firstSeen });
      if (!open.open) {
        attribution = {
          state: 'entry-inactive', entry: ticket.entry,
          reason: `首见 ${toHHMM(ticket.firstSeen)} 时入口 ${ticket.entry} 处于停用通知时段`,
        };
      } else {
        attribution = {
          state: 'attributed', entry: ticket.entry,
          reason: open.assumed ? '首厅已观察，无停用通知，按开放处理' : '首厅已观察且入口通知为开放',
        };
      }
    }

    // 旅程中途实际经过的入口（来自布局解析），用于“可观察范围”而非归属
    const entriesObserved = [...new Set(guideSegs.map(s => s.entry).filter(Boolean))].sort();
    const hallsObserved = [...new Set(
      [...guideSegs.map(s => s.hall), ...physicalSegs.map(s => s.hall)].filter(Boolean),
    )].sort();
    const observationGaps = physicalSegs.filter(s => !s.observed)
      .map(s => ({ eventId: s.eventId, hall: s.hall, reason: s.observeReason, minute: s.minute }));

    journeys.push({
      journeyId: key,
      visit,
      day,
      party: ticket.party,
      kind: ticket.kind,
      partySize: ticket.partySize,
      ticketEntry: ticket.entry,
      firstSeen: ticket.firstSeen,
      attribution,
      segments: ordered,
      entriesObserved,
      hallsObserved,
      counts: {
        guidePlays: guideSegs.length,
        qualifiedPlays: qualifiedPlays.length,
        physical: physicalSegs.length,
        observedPhysical: observedPhysical.length,
      },
      effectiveGuide,
      effectivePhysical,
      physicalAfterGuide,
      effectiveVisit,
      observationGaps,
      includesStaff: ticket.kind === 'staff',
    });
  }

  journeys.sort((a, b) => a.day - b.day || a.journeyId.localeCompare(b.journeyId));

  return {
    journeys,
    duplicateEvents,
    touchEvents,
    orphanEvents,
  };
}

/**
 * 检测布局中的入口切换：同一终端同一日内，相邻布局窗口服务的入口发生变化。
 * 这是临展调入口在数据里留下的观测点，效果分析必须保留该日期。
 */
export function detectEntranceChanges(data) {
  const changes = [];
  const byTerminalDay = new Map();
  for (const row of data.layout) {
    const key = `${row.terminal}|${row.day}`;
    if (!byTerminalDay.has(key)) byTerminalDay.set(key, []);
    byTerminalDay.get(key).push(row);
  }
  for (const [key, rows] of byTerminalDay) {
    const ordered = [...rows].sort((a, b) => a.window[0] - b.window[0]);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].entry !== ordered[i - 1].entry) {
        const [terminal, dayPart] = key.split('|');
        changes.push({
          day: Number(dayPart),
          terminal,
          atMinute: ordered[i].window[0],
          at: toHHMM(ordered[i].window[0]),
          fromEntry: ordered[i - 1].entry,
          toEntry: ordered[i].entry,
        });
      }
    }
  }
  return changes.sort((a, b) => a.day - b.day || a.atMinute - b.atMinute);
}
