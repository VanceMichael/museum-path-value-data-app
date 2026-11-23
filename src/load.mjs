// 读取一轮交接资料目录，按 format.json 的字段清单解析为结构化数据。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, splitValues } from './csv.mjs';
import { toMinutes } from './time.mjs';

async function readTable(folder, name, fields) {
  const content = await readFile(join(folder, `${name}.csv`), 'utf8');
  return parseCsv(content, fields, name);
}

/**
 * @returns {object} 原始字符串行 + 派生索引，全部分析模块共用同一份加载结果
 */
export async function loadData(folder) {
  const format = JSON.parse(await readFile(join(folder, 'format.json'), 'utf8'));
  const raw = {};
  for (const [name, fields] of Object.entries(format.tables)) {
    raw[name] = await readTable(folder, name, fields);
  }
  return buildIndexes(raw);
}

export function buildIndexes(raw) {
  const data = { raw };

  data.tickets = raw.tickets.map(row => ({
    visit: row.visit,
    day: Number(row.day),
    party: row.party,
    kind: row.kind, // public | group | staff
    entry: row.entry,
    partySize: Number(row.party_size),
    firstSeen: toMinutes(row.first_seen), // 可能为 null：第一次进入哪厅观察不到
  }));
  data.ticketByVisit = new Map(data.tickets.map(ticket => [ticket.visit, ticket]));

  data.events = raw.events.map((row, index) => ({
    id: row.entry,
    rowIndex: index,
    visit: row.visit,
    terminal: row.terminal,
    day: Number(row.day),
    recordedMinute: toMinutes(row.time), // 终端本地时钟（未校准）
    type: row.type, // touch | play | physical
    content: row.content,
    seconds: Number(row.seconds),
  }));
  data.eventById = new Map(data.events.map(event => [event.id, event]));

  data.layout = raw.layout.map(row => ({
    day: Number(row.day),
    entry: row.entry,
    terminal: row.terminal,
    hall: row.hall,
    window: [toMinutes(row.from), toMinutes(row.to)],
    language: row.language,
    assist: row.assist === 'true',
  }));

  data.offsets = raw['clock-offsets'].map(row => ({
    terminal: row.terminal,
    day: Number(row.day),
    secondsAdd: Number(row.seconds_add),
    knownDay: Number(row.known_day), // 该校准值是哪一天之后才被馆方知道的
  }));

  data.contracts = raw.contracts.map(row => ({
    partner: row.partner,
    content: row.content,
    requiredSlots: Number(row.required_slots),
    qualifiedMinSeconds: Number(row.qualified_min_seconds),
    sharedTerminal: row.shared_terminal,
    languages: splitValues(row.languages),
  }));
  data.contractByPair = new Map(data.contracts.map(c => [`${c.partner}|${c.content}`, c]));

  data.options = raw.options.map(row => ({
    option: row.option,
    terminal: row.terminal,
    day: Number(row.day),
    window: [toMinutes(row.from), toMinutes(row.to)],
    contents: splitValues(row.contents),
    assistDevices: Number(row.assist_devices),
  }));

  data.physicalScan = raw['physical-scan'].map(row => ({
    day: Number(row.day),
    terminal: row.terminal,
    hall: row.hall,
    window: [toMinutes(row.first), toMinutes(row.last)],
    status: row.status, // active | unobserved
  }));

  data.sharing = raw.sharing.map(row => ({
    partner: row.partner,
    content: row.content,
    creditWeight: Number(row.credit_weight),
    fromDay: Number(row.from_day),
    toDay: Number(row.to_day),
  }));

  data.signed = raw['signed-exposures'].map(row => ({
    record: row.record,
    partner: row.partner,
    terminal: row.terminal,
    day: Number(row.day),
    window: [toMinutes(row.from), toMinutes(row.to)],
    entry: row.entry,
    content: row.content,
    evidenceEvent: row.evidence_event === '' ? null : row.evidence_event,
    issuedDay: Number(row.issued_day),
    state: row.state, // signed | scheduled
  }));

  data.notices = raw['entrance-notices'].map(row => ({
    notice: row.notice,
    entry: row.entry,
    day: Number(row.day),
    window: [toMinutes(row.from), toMinutes(row.to)],
    status: row.status, // open | closed
    knownDay: Number(row.known_day),
  }));

  data.equipment = raw['access-equipment'].map(row => ({
    device: row.device,
    day: Number(row.day),
    window: [toMinutes(row.from), toMinutes(row.to)],
    terminals: splitValues(row.terminals),
  }));

  data.editions = raw['content-editions'].map(row => ({
    terminal: row.terminal,
    content: row.content,
    day: Number(row.day),
    window: [toMinutes(row.from), toMinutes(row.to)],
    edition: row.edition,
    language: row.language,
  }));

  return data;
}
