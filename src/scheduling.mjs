// 候选入口与讲解排期评估（面向新一轮，fixtures 中为第 4 日）。
//
// 硬约束：
// 1. 同一终端时段不能被两个选项完全/部分并行占用（屏幕不可完全并行占用）；
// 2. 辅助设备时段不可被完全并行占用——同一设备在重叠窗口只能服务一个终端；
// 3. 有限译制/无障碍设备必须覆盖正在开放入口的需求终端（覆盖缺口要显式报出）；
// 4. 入口临时关闭窗口内的安排要被裁剪并标红，不能把关闭时段算作履行；
// 5. 两家合作方共用屏幕时，同一时段信用按 sharing 权重拆分，不能各拿整段。
//
// 第 4 日尚无 layout，终端服务入口汇总该终端历史布局日出现过的入口（报告里写明这是假设）。

import { intersection, overlaps, toHHMM, duration } from './time.mjs';
import { terminalEntries } from './context.mjs';

function openWindowsForEntry(data, entry, day) {
  const windows = [];
  const notices = data.notices
    .filter(n => n.entry === entry && n.day === day)
    .sort((a, b) => a.window[0] - b.window[0]);
  for (const notice of notices) {
    if (notice.status === 'open') windows.push(notice.window);
    else windows.push({ closed: notice.window, notice: notice.notice });
  }
  return windows;
}

/** 终端在候选日服务的入口（汇总该终端全部历史布局日出现过的入口） */
export function terminalEntryAssumption(data, terminal, planDay) {
  const days = [...new Set(data.layout.filter(row => row.terminal === terminal).map(row => row.day))].sort();
  const entries = [...new Set(
    data.layout.filter(row => row.terminal === terminal).map(row => row.entry),
  )].sort();
  return { basedOnDays: days, entries };
}

/** 历史合格密度：每个 (终端, 内容) 每分钟合格播放产生的合格时段数，用于估算新排期 */
function historicalQualification(data, credits) {
  const density = new Map();
  for (const detail of credits.slotDetails) {
    const key = `${detail.terminal}|${detail.content}`;
    if (!density.has(key)) density.set(key, { credits: 0, minutesSeen: 0 });
    const acc = density.get(key);
    acc.credits += detail.credit;
  }
  // 用每个终端历史开放分钟数做分母
  const openMinutes = new Map();
  for (const row of data.layout) {
    const key = row.terminal;
    openMinutes.set(key, (openMinutes.get(key) ?? 0) + duration(row.window));
  }
  const rate = new Map();
  for (const [key, acc] of density) {
    const terminal = key.split('|')[0];
    const minutes = openMinutes.get(terminal) || 1;
    rate.set(key, acc.credits / minutes);
  }
  return rate;
}

function weightFor(data, partner, content, day) {
  const rule = data.sharing.find(s =>
    s.partner === partner && s.content === content && day >= s.fromDay && day <= s.toDay);
  return rule?.creditWeight ?? 1;
}

/** 单选项评估：入口裁剪、终端/设备冲突、信用与有效参观估算 */
export function evaluateOption(data, option, credits) {
  const assumption = terminalEntryAssumption(data, option.terminal, option.day);
  const rate = historicalQualification(data, credits);

  // 入口开放裁剪：任一服务入口关闭都要记录；可用时段 = 选项窗口与“开放窗口并集”的交集
  const closureRisks = [];
  const openUnion = [];
  for (const entry of assumption.entries) {
    for (const item of openWindowsForEntry(data, entry, option.day)) {
      if (item.closed && overlaps(option.window, item.closed)) {
        const hit = intersection(option.window, item.closed);
        closureRisks.push({
          entry, notice: item.notice,
          closedFrom: toHHMM(hit[0]), closedTo: toHHMM(hit[1]),
          minutes: duration(hit),
        });
      }
    }
    for (const window of data.notices
      .filter(n => n.entry === entry && n.day === option.day && n.status === 'open')
      .map(n => n.window)) {
      const merged = openUnion.find(w => overlaps(w, window) || w[1] === window[0]);
      if (merged) {
        merged[0] = Math.min(merged[0], window[0]);
        merged[1] = Math.max(merged[1], window[1]);
      } else {
        openUnion.push([...window]);
      }
    }
  }
  // 任一服务入口开放即可使用；取选项窗口落在开放并集内的部分
  let usableWindow = null;
  for (const window of openUnion.sort((a, b) => a[0] - b[0])) {
    const hit = intersection(option.window, window);
    if (hit) usableWindow = usableWindow ? [Math.min(usableWindow[0], hit[0]), Math.max(usableWindow[1], hit[1])] : hit;
  }
  if (!usableWindow) usableWindow = [option.window[0], option.window[0]];

  // 信用估算：窗口可容纳的 20 分钟时段数 × 历史合格密度 × 20 × 共享权重
  const estimatedCredits = data.contracts
    .filter(contract => option.contents.includes(contract.content))
    .map(contract => {
      const density = rate.get(`${option.terminal}|${contract.content}`) ?? 0;
      const slots = duration(usableWindow) / 20;
      return {
        partner: contract.partner,
        content: contract.content,
        weight: weightFor(data, contract.partner, contract.content, option.day),
        estimatedSlots: Number((slots * Math.min(1, density * 20)
          * weightFor(data, contract.partner, contract.content, option.day)).toFixed(3)),
        densityBasis: Number(density.toFixed(5)),
      };
    });

  // 设备需求：选项声明的 assist_devices 数量
  const equipmentNeed = data.equipment
    .filter(eq => eq.terminals.includes(option.terminal) && overlaps(eq.window, usableWindow))
    .map(eq => ({
      device: eq.device,
      window: [Math.max(eq.window[0], usableWindow[0]), Math.min(eq.window[1], usableWindow[1])],
      devicesDeclared: option.assistDevices,
    }));

  return {
    option: option.option,
    terminal: option.terminal,
    day: option.day,
    requestedWindow: { from: toHHMM(option.window[0]), to: toHHMM(option.window[1]) },
    usableWindow: { from: toHHMM(usableWindow[0]), to: toHHMM(usableWindow[1]), minutes: duration(usableWindow) },
    entries: assumption.entries,
    entryBasis: `汇总第 ${assumption.basedOnDays.join('、')} 日布局的入口归属（候选日尚无 layout）`,
    contents: option.contents,
    assistDevicesNeeded: option.assistDevices,
    equipmentNeed,
    closureRisks,
    estimatedCredits,
  };
}

function pairConflicts(data, options) {
  const conflicts = [];
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i];
      const b = options[j];
      if (!overlaps(a.window, b.window)) continue;
      if (a.terminal === b.terminal) {
        conflicts.push({ between: [a.option, b.option], type: 'terminal-overlap', reason: '同一屏幕时段被并行占用' });
      }
      for (const eq of data.equipment) {
        const servesA = eq.terminals.includes(a.terminal);
        const servesB = eq.terminals.includes(b.terminal);
        // 同一台设备在重叠时段被两个不同终端争用（同终端的冲突已由 terminal-overlap 表达）
        if (a.terminal !== b.terminal && servesA && servesB
          && overlaps(eq.window, a.window) && overlaps(eq.window, b.window)) {
          conflicts.push({
            between: [a.option, b.option], type: 'assist-device-overlap',
            reason: `设备 ${eq.device} 在重叠时段无法同时服务 ${a.terminal} 与 ${b.terminal}`,
            device: eq.device,
          });
        }
      }
    }
  }
  return conflicts;
}

/** 枚举可行选项组合并按“已承诺覆盖 + 估算信用”排序 */
export function buildPlans(data, credits, weekly) {
  const options = data.options;
  const conflicts = pairConflicts(data, options);
  const evaluations = options.map(option => evaluateOption(data, option, credits));
  const evalByOption = new Map(evaluations.map(e => [e.option, e]));

  const conflictPair = new Set(conflicts.map(c => c.between.join('|')));
  const plans = [];
  const n = options.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const chosen = options.filter((_, i) => mask & (1 << i)).map(o => o.option);
    const hit = chosen.some((a, i) => chosen.slice(i + 1).some(b => conflictPair.has(`${a}|${b}`) || conflictPair.has(`${b}|${a}`)));
    if (hit) continue;

    const creditByContract = new Map();
    for (const optionId of chosen) {
      for (const credit of evalByOption.get(optionId).estimatedCredits) {
        const key = `${credit.partner}|${credit.content}`;
        creditByContract.set(key, Number(((creditByContract.get(key) ?? 0) + credit.estimatedSlots).toFixed(3)));
      }
    }

    const commitments = weekly.map(row => {
      const planned = creditByContract.get(`${row.partner}|${row.content}`) ?? 0;
      return {
        partner: row.partner,
        content: row.content,
        requiredSlots: row.requiredSlots,
        observedSlots: row.observedSlots,
        remainingSlots: row.remainingSlots,
        plannedSlots: planned,
        covered: Number((row.observedSlots + planned).toFixed(2)) >= row.requiredSlots,
      };
    });

    const closureRiskOptions = chosen.filter(id => evalByOption.get(id).closureRisks.length > 0);
    const assistGaps = chosen.flatMap(id => {
      const evaluation = evalByOption.get(id);
      return evaluation.equipmentNeed.length === 0
        ? [{ option: id, reason: `终端 ${evaluation.terminal} 在可用时段无匹配的辅助设备记录` }]
        : [];
    });

    plans.push({
      options: chosen,
      commitmentCoverage: commitments,
      allCommitmentsCovered: commitments.every(c => c.covered),
      totalEstimatedSlots: Number([...creditByContract.values()].reduce((a, b) => a + b, 0).toFixed(3)),
      closureRiskOptions,
      assistGaps,
    });
  }

  plans.sort((a, b) =>
    Number(b.allCommitmentsCovered) - Number(a.allCommitmentsCovered)
    || b.totalEstimatedSlots - a.totalEstimatedSlots
    || a.options.length - b.options.length);

  // 无障碍覆盖检查：开放入口对应的历史 assist=true 终端必须出现在可行组合里
  const assistRequiredTerminals = [...new Set(
    data.layout.filter(row => row.assist).map(row => row.terminal),
  )];
  const planDay = options[0]?.day;
  const openEntries = [...new Set(data.notices.filter(n => n.day === planDay && n.status === 'open').map(n => n.entry))];

  return {
    options: evaluations,
    conflicts,
    plans,
    recommended: plans[0] ?? null,
    assistCoverage: {
      planDay,
      openEntries,
      assistRequiredTerminals,
      equipment: data.equipment.map(eq => ({
        device: eq.device, window: { from: toHHMM(eq.window[0]), to: toHHMM(eq.window[1]) }, terminals: eq.terminals,
      })),
      note: '设备必须覆盖正在开放入口的 assist 需求终端；缺口在各计划 assistGaps 中列出',
    },
  };
}
