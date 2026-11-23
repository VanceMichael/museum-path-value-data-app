#!/usr/bin/env node
// 用法：node bin/analyze.mjs <资料目录> [--out 输出目录] [--partner P1] [--json]
// 每轮新的场内匿名事件与票务卷放进一个目录即可重跑。
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { runAnalysis } from '../src/pipeline.mjs';

function parseArgs(argv) {
  const args = { out: null, partner: null, json: false, folder: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out') args.out = resolve(rest[++i]);
    else if (rest[i] === '--partner') args.partner = rest[++i];
    else if (rest[i] === '--json') args.json = true;
    else if (!rest[i].startsWith('--')) args.folder = resolve(rest[i]);
  }
  if (!args.folder) {
    console.error('用法: node bin/analyze.mjs <资料目录> [--out 输出目录] [--partner 合作方] [--json]');
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv);
const analysis = await runAnalysis(args.folder);

if (args.json) {
  process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
} else {
  const lines = [];
  lines.push(`# 分析轮次 ${analysis.manifest.runLabel}`);
  lines.push(`资料目录：${analysis.manifest.sourceFolder}`);
  lines.push('');
  lines.push('## 旅程质量');
  lines.push(`有效参观(公众)：${analysis.journeySummary.effectiveVisits} / ${analysis.journeySummary.publicJourneys} 段旅程`);
  lines.push(`重复播放去重：${analysis.dataQuality.duplicatePlayCount} 条；误触忽略：${analysis.dataQuality.touchEventsIgnored} 条；无票域事件：${analysis.dataQuality.orphanEvents} 条`);
  lines.push(`归属分布：${JSON.stringify(analysis.journeySummary.attributionBreakdown)}`);
  lines.push('');
  lines.push('## 入口可观察/可归属范围');
  for (const scope of analysis.entranceScopes) {
    lines.push(`- 入口 ${scope.entry}：可观察 ${scope.observableCount}，可归属 ${scope.attributableCount}，其中有效参观 ${scope.effectiveAttributable}`);
    if (scope.unobservableFirstHall.length) lines.push(`  首厅未观察(不硬归属)：${scope.unobservableFirstHall.join('、')}`);
    if (scope.inactiveEntry.length) lines.push(`  入口停用(不归属)：${scope.inactiveEntry.join('、')}`);
  }
  lines.push('');
  lines.push('## 已签曝光核对');
  for (const record of analysis.signedReconciliation.records) {
    lines.push(`- ${record.record} (${record.partner}/${record.content})：${record.status} — ${record.headline}`);
  }
  lines.push('');
  lines.push('## 推荐排期');
  if (analysis.scheduling.recommended) {
    const plan = analysis.scheduling.recommended;
    lines.push(`选项组合：${plan.options.join('、')}；估算合格时段：${plan.totalEstimatedSlots}；承诺全覆盖：${plan.allCommitmentsCovered ? '是' : '否'}`);
  }
  for (const conflict of analysis.scheduling.conflicts) {
    lines.push(`冲突：${conflict.between.join(' vs ')} — ${conflict.reason}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (args.partner) {
  const report = analysis.reports.partnerWeekly.find(r => r.partner === args.partner);
  if (!report) {
    console.error(`合作方 ${args.partner} 无合约记录`);
    process.exit(2);
  }
  const outDir = args.out ?? resolve('reports');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, `partner-${args.partner}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.error(`已写出合作方 ${args.partner} 周报到 ${outDir}/partner-${args.partner}.json`);
} else if (args.out) {
  await mkdir(args.out, { recursive: true });
  await writeFile(resolve(args.out, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
  for (const report of analysis.reports.partnerWeekly) {
    await writeFile(resolve(args.out, `partner-${report.partner}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.error(`已写出完整分析与各合作方周报到 ${args.out}（基于 ${basename(args.folder)}）`);
}
