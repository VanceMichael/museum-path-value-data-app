# 数字展项导览的跨展厅成效与曝光安排

业务资料均为合成记录。表头字段及跨表引用见 `fixtures/format.json`。

## 数据说明

票务键只在同一 visit 与日号内表示匿名旅程，party 字段重复不代表跨日同人。团体大小用于汇总证据解释，人员身份不可反查。terminal 记录时钟加上 clock-offsets.seconds_add 才进入本地排期。layout 时间半开，physical-scan 标示实体展厅观察覆盖。相同票域、内容与相同开始时点的重复上报仅代表同一播放。
合约口径以合格时段为单位，content、最少讲解秒数与语言都需满足；共享时段有两个合作方资格时，sharing 的权重按匹配份额分配，不重复记整段。屏幕及辅助设备的时段不可被完全并行占用。
content-editions 是播放内容版本与语言的时段记录。signed-exposures 保留合作方已收到的依据，evidence_event 是当日归入该约定时段的事件；scheduled 还没有实绩。entrance-notices 是入口现场开放通知，access-equipment 逐项登记能够调配的辅助设备及其可服务终端。合格时段以已约定的入口、终端及内容为准，已签时段在更正后仍可追看签发依据。

CSV 使用 UTF-8、逗号分隔，无引号与内嵌换行。未提供的字段是空字符串，作为关系值的 `-` 表示不适用。多值字段用竖线分隔，数值和日期单位见业务约定。

## 资料检查

使用 Node.js 22.23.4，依赖仅为 Node.js 标准库。运行 `npm ci --ignore-scripts --offline` 准备工作区。

运行 `npm run check:materials` 检查合成交接资料的字段与记录引用。运行 `npm test` 检查交接资料的读取和校验。
