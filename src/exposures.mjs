// 合作方合格曝光核算与已签曝光核对。
//
// 合格时段口径：共享终端当日布局开放窗口按 20 分钟网格切成半开时段；
// 一个网格时段内存在至少一条“去重后、秒数达标、语言达标、落在开放布局内”的播放，
// 即记为该合作方内容的一个合格时段。
// 同一网格时段两个合作方内容同时合格（共享屏幕）时，按 sharing.credit_weight 拆分，
// 任何一方都不能独占整段；sharing 仅在其有效日区间内适用。

import { minuteAsOf, correctedMinute, clockRevisions } from './clock.mjs';
import { layoutAt, editionAt } from './context.mjs';
import { toHHMM } from './time.mjs';

const SLOT_MINUTES = 20;
const slotStart = minute => Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;

function segmentQualifiesForContract(segment, contract) {
  return segment.kind === 'guide'
    && segment.terminal === contract.sharedTerminal
    && segment.content === contract.content
    && segment.withinLayout
    && segment.entryOpen
    && segment.seconds >= contract.qualifiedMinSeconds
    && segment.editionLanguage !== null
    && contract.languages.includes(segment.editionLanguage);
}

function sharingActive(sharing, partner, content, day) {
  return sharing.some(s =>
    s.partner === partner && s.content === content && day >= s.fromDay && day <= s.toDay);
}

/**
 * 基于已发生事件（校准后的当前记录）统计每合作方的合格时段信用。
 * 返回按 (day, terminal, slot) 展开的明细与周累计。
 */
export function observedExposureCredits(data, journeyResult) {
  const guideSegments = journeyResult.journeys.flatMap(j => j.segments.filter(s => s.kind === 'guide'));
  // slotKey -> Map(partnerKey -> {contract, segment})
  const slots = new Map();

  for (const segment of guideSegments) {
    for (const contract of data.contracts) {
      if (!segmentQualifiesForContract(segment, contract)) continue;
      const key = `${segment.day}|${segment.terminal}|${slotStart(segment.minute)}`;
      if (!slots.has(key)) slots.set(key, new Map());
      const partnerKey = `${contract.partner}|${contract.content}`;
      if (!slots.get(key).has(partnerKey)) {
        slots.get(key).set(partnerKey, { contract, segment });
      }
    }
  }

  const slotDetails = [];
  const partnerCredit = new Map();
  const addCredit = (partner, content, day, credit, slot, shared) => {
    const key = `${partner}|${content}`;
    if (!partnerCredit.has(key)) {
      partnerCredit.set(key, { partner, content, days: new Map(), qualifiedSlots: 0, sharedSlots: 0 });
    }
    const acc = partnerCredit.get(key);
    acc.qualifiedSlots = Number((acc.qualifiedSlots + credit).toFixed(4));
    if (shared) acc.sharedSlots += 1;
    acc.days.set(day, Number(((acc.days.get(day) ?? 0) + credit).toFixed(4)));
    slotDetails.push({
      day, terminal: slot.terminal, slotStart: toHHMM(slot.start), slotEnd: toHHMM(slot.start + SLOT_MINUTES),
      partner, content, credit, shared, evidenceEvent: slot.evidence.get(partnerKeyOf(partner, content))?.segment.eventId,
    });
  };

  for (const [key, qualified] of slots) {
    const [dayPart, terminal, startPart] = key.split('|');
    const day = Number(dayPart);
    const start = Number(startPart);
    const partners = [...qualified.keys()];
    const shared = partners.length > 1;
    const evidence = qualified;
    for (const partnerKey of partners) {
      const { contract } = qualified.get(partnerKey);
      let credit = 1;
      if (shared && sharingActive(data.sharing, contract.partner, contract.content, day)) {
        const rule = data.sharing.find(s =>
          s.partner === contract.partner && s.content === contract.content
          && day >= s.fromDay && day <= s.toDay);
        credit = rule.creditWeight;
      } else if (shared) {
        credit = 1 / partners.length; // 共享但缺 sharing 约定时的保守均分
      }
      addCredit(contract.partner, contract.content, day, credit, { terminal, start, evidence }, shared);
    }
  }

  const weekly = data.contracts.map(contract => {
    const acc = partnerCredit.get(`${contract.partner}|${contract.content}`);
    const observed = acc?.qualifiedSlots ?? 0;
    return {
      partner: contract.partner,
      content: contract.content,
      requiredSlots: contract.requiredSlots,
      observedSlots: Number(observed.toFixed(2)),
      remainingSlots: Number(Math.max(0, contract.requiredSlots - observed).toFixed(2)),
      sharedSlots: acc?.sharedSlots ?? 0,
      byDay: acc ? Object.fromEntries([...acc.days.entries()].sort((a, b) => a[0] - b[0])) : {},
    };
  });

  return { slotDetails: slotDetails.sort((a, b) => a.day - b.day || a.slotStart.localeCompare(b.slotStart)), weekly };
}

function partnerKeyOf(partner, content) {
  return `${partner}|${content}`;
}

function evaluateEventForRecord(data, event, contract, minute) {
  if (!event) {
    return { qualified: false, inWindow: false, reasons: ['缺少 evidence_event，无实绩可核'] };
  }
  const layout = layoutAt(data, { day: event.day, terminal: event.terminal, minute });
  const edition = editionAt(data, {
    day: event.day, terminal: event.terminal, content: event.content, minute,
  });
  const reasons = [];
  const inWindow = minute >= contract._window[0] && minute < contract._window[1];
  if (!inWindow) reasons.push(`校准后时点 ${toHHMM(minute)} 落在约定窗口 ${toHHMM(contract._window[0])}-${toHHMM(contract._window[1])} 之外`);
  if (!layout) reasons.push('时点不在终端任何布局开放窗口内');
  if (layout && layout.entry !== contract._entry) reasons.push(`时点布局入口为 ${layout.entry}，约定入口为 ${contract._entry}`);
  if (event.content !== contract.content) reasons.push(`内容 ${event.content} 与约定 ${contract.content} 不符`);
  if (event.seconds < contract.qualifiedMinSeconds) reasons.push(`播放 ${event.seconds} 秒低于合格线 ${contract.qualifiedMinSeconds} 秒`);
  if (edition && !contract.languages.includes(edition.language)) reasons.push(`语言 ${edition.language} 不在约定 ${contract.languages.join('|')} 内`);
  if (!edition) reasons.push('时点无内容版本记录，语言无法核对');
  const qualified = reasons.length === 0;
  return {
    qualified, inWindow, minute,
    entryAtTime: layout?.entry ?? null,
    edition: edition?.edition ?? null,
    language: edition?.language ?? null,
    reasons,
  };
}

/**
 * 已签曝光核对：分别用“签发当时已知的校准”和“当前最新校准”回放证据事件。
 * 状态：fulfilled 已履行 / insufficient 证据不足（需补偿）/ pending 仅排期待实绩。
 */
export function reconcileSigned(data) {
  const revisions = clockRevisions(data.offsets);
  const records = data.signed.map(signed => {
    const contract = data.contractByPair.get(`${signed.partner}|${signed.content}`);
    const scoped = { ...contract, _window: signed.window, _entry: signed.entry };
    const event = signed.evidenceEvent ? data.eventById.get(signed.evidenceEvent) : null;

    const basisAtIssue = event
      ? evaluateEventForRecord(data, event, scoped, minuteAsOf(event, data.offsets, signed.issuedDay))
      : evaluateEventForRecord(data, null, scoped, null);
    const current = event
      ? evaluateEventForRecord(data, event, scoped, correctedMinute(event, data.offsets))
      : evaluateEventForRecord(data, null, scoped, null);

    let status;
    let compensable = false;
    let headline;
    if (signed.state === 'scheduled' || !event) {
      status = 'pending';
      headline = '仅排期、尚无实绩，待履行';
    } else if (basisAtIssue.qualified && current.qualified) {
      status = 'fulfilled';
      headline = '签发依据成立，按最新记录仍兑现';
    } else if (basisAtIssue.qualified && !current.qualified) {
      status = 'insufficient';
      compensable = true;
      headline = '签发当时成立，时钟再校准后按新记录不再兑现，待补偿';
    } else {
      status = 'insufficient';
      compensable = true;
      headline = '签发依据本身不满足合格口径，证据不足，待补偿';
    }

    const clockImpact = event
      ? revisions.find(r => r.terminal === event.terminal && r.day === event.day) ?? null
      : null;

    return {
      record: signed.record,
      partner: signed.partner,
      content: signed.content,
      terminal: signed.terminal,
      day: signed.day,
      signedWindow: { from: toHHMM(signed.window[0]), to: toHHMM(signed.window[1]) },
      entry: signed.entry,
      evidenceEvent: signed.evidenceEvent,
      issuedDay: signed.issuedDay,
      signedState: signed.state,
      status,
      compensable,
      headline,
      clockImpact,
      basisAtIssue: basisAtIssue === null ? null : {
        ...basisAtIssue,
        minuteLabel: basisAtIssue.minute === null || basisAtIssue.minute === undefined ? null : toHHMM(basisAtIssue.minute),
      },
      currentView: {
        ...current,
        minuteLabel: current.minute === null || current.minute === undefined ? null : toHHMM(current.minute),
      },
    };
  });

  const compensation = data.contracts.map(contract => ({
    partner: contract.partner,
    content: contract.content,
    compensableRecords: records
      .filter(r => r.compensable && r.partner === contract.partner && r.content === contract.content)
      .map(r => r.record),
  })).filter(row => row.compensableRecords.length > 0);

  return {
    records,
    compensation,
    clockRevisions: revisions,
  };
}
