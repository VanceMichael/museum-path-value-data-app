// 半开区间 [from, to) 的时间工具，时间内部统一用“当日分钟数”表示。

export function toMinutes(hhmm) {
  if (hhmm === '' || hhmm === '-') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`时间格式应为 HH:MM，收到 ${hhmm}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function toHHMM(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 区间是否包含某分钟（半开） */
export function contains([from, to], minute) {
  return minute >= from && minute < to;
}

/** 两个半开区间是否重叠 */
export function overlaps(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

/** 交集，无交集返回 null */
export function intersection(a, b) {
  const from = Math.max(a[0], b[0]);
  const to = Math.min(a[1], b[1]);
  return from < to ? [from, to] : null;
}

/** 用裁剪区间去切目标窗口，返回落在可用区间内的部分 */
export function clip(window, available) {
  return intersection(window, available);
}

export function duration([from, to]) {
  return to - from;
}
