# 数字展项导览的跨展厅成效与曝光安排

业务资料均为合成记录。表头字段及跨表引用见 `fixtures/format.json`。本项目在原有资料检查
脚手架之上，提供可逐轮重跑的 Node.js 分析管线：每来一轮新的场内匿名事件与票务卷，
放入一个目录即可重新计算旅程、入口归属、线路效果、合作方曝光与候选排期。

## 数据说明

票务键只在同一 visit 与日号内表示匿名旅程，party 字段重复不代表跨日同人。团体大小用于
汇总证据解释，人员身份不可反查。terminal 记录时钟加上 clock-offsets.seconds_add 才进入
本地排期。layout 时间半开，physical-scan 标示实体展厅观察覆盖。相同票域、内容与相同
开始时点的重复上报仅代表同一播放。

合约口径以合格时段为单位，content、最少讲解秒数与语言都需满足；共享时段有两个合作方
资格时，sharing 的权重按匹配份额分配，不重复记整段。屏幕及辅助设备的时段不可被完全
并行占用。

content-editions 是播放内容版本与语言的时段记录。signed-exposures 保留合作方已收到的
依据，evidence_event 是当日归入该约定时段的事件；scheduled 还没有实绩。
entrance-notices 是入口现场开放通知，access-equipment 逐项登记能够调配的辅助设备及其
可服务终端。合格时段以已约定的入口、终端及内容为准，已签时段在更正后仍可追看签发依据。

CSV 使用 UTF-8、逗号分隔，无引号与内嵌换行。未提供的字段是空字符串，作为关系值的 `-`
表示不适用。多值字段用竖线分隔，数值和日期单位见业务约定。

## 分析口径（代码实现位置）

| 业务要求 | 实现位置 | 口径要点 |
| --- | --- | --- |
| 匿名票当日馆内串联、公用屏多段同旅程 | `src/journeys.mjs` | 按 (visit, day) 串联，团体计 1 次、工作人员单列 |
| 误触与重复启动不增加有效参观 | `src/journeys.mjs` | touch 直接忽略；同票域+内容+开始时点的重复播放去重（E4/E5） |
| 不完整旅程不归到停用入口 | `src/journeys.mjs` / `src/attribution.mjs` | first_seen 缺失=首厅不可观察，只进可观察集合；首见落在关闭通知=entry-inactive，不归属 |
| 各入口可观察旅程与归属范围 | `src/attribution.mjs` | 可观察（段落经布局落在该入口）与可归属（首厅可见且入口开放）分开计数 |
| 调入口日期/讲解版本/共同流量/跟团观测限制 | `src/effects.mjs` | 比较结果带 comparability 与 observationLimits，不直接给因果结论 |
| 首厅观察不到≠没经过 | `src/journeys.mjs` | 保留 entriesObserved，attribution 标 first-hall-unobserved |
| 被引导至另一线路的厅不作独立参照 | `src/effects.mjs` | 跨终端旅程/跨线路引导 → shared-traffic，independentReference=false |
| 合格曝光与共享权重 | `src/exposures.mjs` | 20 分钟半开网格；秒数、语言、开放布局均达标；共享按 credit_weight 拆分 |
| 已履行/证据不足/待补偿 | `src/exposures.mjs` | 分别按签发日已知校准与最新校准回放证据事件（R1/R2/R3/R4） |
| 时钟再校准定位 | `src/clock.mjs` | 同一终端日多条 offset 形成修订清单，标注受影响事件与旅程 |
| 候选入口与讲解排期 | `src/scheduling.mjs` | 屏幕/设备并行冲突、入口关闭裁剪、承诺覆盖、可行组合排序 |
| 有限译制与无障碍设备覆盖开放入口 | `src/scheduling.mjs` | assistCoverage 与各计划 assistGaps |
| 合作方周报隔离 | `src/reports.mjs` | 每份周报仅含本合作方约定内容，附可信度与不可见声明 |
| 联合策展跨路线视图 | `src/reports.mjs` | 跨线路证据、调入口效果、扫描失效与归属限制 |

可信度分级：`high`（当前校准下直接事件证据齐全）、`medium`（存在共享折算或扫描失效窗口）、
`low`（再校准后失效、证据不足待补偿，或证据事件直接受时钟修订影响）。

## 目录结构

```
src/
  csv.mjs          CSV 解析/序列化（沿用无引号约定）
  time.mjs         半开区间时间工具
  load.mjs         一轮资料加载与派生索引
  clock.mjs        时钟校准、签发时点回放、再校准修订
  context.mjs      布局/入口通知/内容版本/扫描覆盖解析
  journeys.mjs     去重、误触过滤、旅程重建、有效性与归属判定
  attribution.mjs  入口可观察范围、可归属范围、每日汇总
  effects.mjs      导览线路对后续实体参观的比较与独立参照判定
  exposures.mjs    合格时段、共享权重、已签曝光核对与补偿清单
  scheduling.mjs   候选排期约束检查、可行组合与承诺覆盖
  reports.mjs      合作方周报、联合策展视图、管理员视图
  pipeline.mjs     主入口，含输入指纹清单
bin/analyze.mjs    命令行入口
test/              node:test 口径测试
tools/             原资料检查脚本
fixtures/          合成交接资料
```

## 使用方式

使用 Node.js 22.23.4，依赖仅为 Node.js 标准库。运行 `npm ci --ignore-scripts --offline`
准备工作区（本项目无第三方依赖）。

```bash
npm run check:materials     # 检查合成交接资料的字段与记录引用
npm test                    # 30 项口径测试
npm run analyze             # 对 fixtures 跑一轮分析，终端输出摘要

node bin/analyze.mjs <资料目录> --out <输出目录>
node bin/analyze.mjs <资料目录> --partner P1 --out <输出目录>   # 只导出某合作方周报
node bin/analyze.mjs <资料目录> --json                           # 完整结果输出到 stdout
```

新一轮资料只需保持 `fixtures/format.json` 的表头与引用约定，复制为新目录后把路径传给
`bin/analyze.mjs`。输出 `manifest.inputFingerprints` 是各输入 CSV 的哈希，两轮结果对比
即可定位是哪些资料变动影响了有效旅程、已签曝光与补偿；`manifest.clockRevisions` 直接
列出本轮到站的时钟再校准。

## 资料检查

运行 `npm run check:materials` 检查合成交接资料的字段与记录引用。运行 `npm test`
检查交接资料的读取、校验与全部分析口径。
