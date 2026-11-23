// 时钟校准：终端记录时间 + clock-offsets.seconds_add 才是本地排期时间。
// 同一 (terminal, day) 可能有不同 known_day 的两条校准值——后一条代表时钟被重新校准，
// 旧值解释“签发当时为什么这么算”，新值解释“按现在的记录应该怎么算”。

function offsetFor(offsets, terminal, day, knownByDay = null) {
  const candidates = offsets
    .filter(o => o.terminal === terminal && o.day === day)
    .filter(o => knownByDay === null || o.knownDay <= knownByDay);
  if (candidates.length === 0) return 0;
  // known_day 最大的一条是该时点已知的最新校准
  return candidates.reduce((best, o) => (o.knownDay > best.knownDay ? o : best)).secondsAdd;
}

/** 当前（最新）校准下的本地分钟数 */
export function correctedMinute(event, offsets) {
  return event.recordedMinute + offsetFor(offsets, event.terminal, event.day) / 60;
}

/**
 * 截至某已知日（如签约签发日）当时使用的本地分钟数，用于追看签发依据。
 */
export function minuteAsOf(event, offsets, knownByDay) {
  return event.recordedMinute + offsetFor(offsets, event.terminal, event.day, knownByDay) / 60;
}

/**
 * 找出“时钟再校准”的终端/日：同一键存在多条不同 seconds_add。
 * 返回修订清单，供管线标注哪些已签曝光与旅程受影响。
 */
export function clockRevisions(offsets) {
  const groups = new Map();
  for (const offset of offsets) {
    const key = `${offset.terminal}|${offset.day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offset);
  }
  const revisions = [];
  for (const [key, list] of groups) {
    const values = new Set(list.map(o => o.secondsAdd));
    if (values.size > 1) {
      const ordered = [...list].sort((a, b) => a.knownDay - b.knownDay);
      const [terminal, day] = key.split('|');
      revisions.push({
        terminal,
        day: Number(day),
        before: ordered[0].secondsAdd,
        after: ordered[ordered.length - 1].secondsAdd,
        knownDay: ordered[ordered.length - 1].knownDay,
        shiftedMinutes: (ordered[ordered.length - 1].secondsAdd - ordered[0].secondsAdd) / 60,
      });
    }
  }
  return revisions;
}

/** 某个事件是否落在时钟修订影响范围内 */
export function affectedByRevision(event, revisions) {
  return revisions.some(r => r.terminal === event.terminal && r.day === event.day);
}
