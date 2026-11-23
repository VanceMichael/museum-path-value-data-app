// 交接资料约定：UTF-8、逗号分隔、无引号、无内嵌换行；空字段为空串，关系值 '-' 表示不适用。

export function parseCsv(content, fields, table = '资料') {
  const lines = content.trimEnd().split(/\r?\n/);
  const header = lines.shift().split(',');
  if (header.length !== fields.length || header.some((field, i) => field !== fields[i])) {
    throw new Error(`${table} 的表头与格式约定不一致`);
  }
  return lines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== fields.length || line.includes('"')) {
      throw new Error(`${table} 第 ${index + 2} 行不是约定的字段格式`);
    }
    return Object.fromEntries(fields.map((field, position) => [field, cells[position]]));
  });
}

export function serializeCsv(fields, rows) {
  const escape = value => String(value ?? '').replace(/[",\n]/g, '');
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map(field => escape(row[field])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function splitValues(value) {
  if (value === '' || value === '-') return [];
  return value.split('|');
}
