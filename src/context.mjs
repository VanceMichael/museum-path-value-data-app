// 事件发生时的现场上下文解析：布局窗口、入口开放通知、内容版本、实体厅扫描覆盖。
// 布局与通知时间均为半开区间 [from, to)。
import { contains } from './time.mjs';

export function layoutAt(data, { day, terminal, minute }) {
  return data.layout.find(row =>
    row.day === day && row.terminal === terminal && contains(row.window, minute)) ?? null;
}

export function noticeAt(data, { day, entry, minute }) {
  return data.notices.find(row =>
    row.day === day && row.entry === entry && contains(row.window, minute)) ?? null;
}

/** 入口在某日某分钟是否开放；没有任何通知覆盖时按“无停用证据=开放”处理并标注假设 */
export function entryOpenAt(data, { day, entry, minute }) {
  const notice = noticeAt(data, { day, entry, minute });
  if (!notice) return { open: true, assumed: true, notice: null };
  return { open: notice.status === 'open', assumed: false, notice };
}

export function editionAt(data, { day, terminal, content, minute }) {
  return data.editions.find(row =>
    row.day === day && row.terminal === terminal && row.content === content
    && contains(row.window, minute)) ?? null;
}

/**
 * 实体厅事件的观察覆盖：physical-scan 标示该终端对该厅的观察窗口。
 * active 窗口内可作为参观证据；unobserved 或无窗口覆盖只能记为观察失效。
 */
export function scanCoverageAt(data, { day, terminal, hall, minute }) {
  const scan = data.physicalScan.find(row =>
    row.day === day && row.terminal === terminal && row.hall === hall
    && contains(row.window, minute));
  if (!scan) return { observed: false, reason: 'no-scan-window', status: null };
  return {
    observed: scan.status === 'active',
    reason: scan.status === 'active' ? 'active' : 'unobserved',
    status: scan.status,
  };
}

/** 某终端在某日服务过哪些入口（取该日全部布局记录），排期模块用于候选入口归属 */
export function terminalEntries(data, terminal, day) {
  return [...new Set(
    data.layout.filter(row => row.terminal === terminal && row.day === day).map(row => row.entry),
  )];
}
