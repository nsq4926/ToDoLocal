'use strict';
/* 极简 XLSX 生成器（零依赖）
   仅使用 Node 内置 zlib 手工拼装 OOXML 包：
   [Content_Types].xml / _rels/.rels / xl/workbook.xml / xl/styles.xml /
   xl/worksheets/sheet1.xml（含超链接关系）。
   生成的表格支持表头样式、列宽、自动换行、冻结首行、自动筛选与外部超链接。 */

const zlib = require('zlib');

/* ============================ CRC32 / ZIP ============================ */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, day };
}

/** entries: [{ name: string, data: string|Buffer }] → Buffer（deflate 压缩，UTF-8 文件名） */
function zip(entries, when) {
  const { time, day } = dosStamp(when);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);      // version made by
    central.writeUInt16LE(20, 6);      // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);      // extra length
    central.writeUInt16LE(0, 32);      // comment length
    central.writeUInt16LE(0, 34);      // disk number
    central.writeUInt16LE(0, 36);      // internal attributes
    central.writeUInt32LE(0, 38);      // external attributes
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, end]);
}

/* ============================ XML 工具 ============================ */
function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return width;
}

function countLines(text, width) {
  const perLine = Math.max(6, Number(width) || 14);
  return String(text).split('\n').reduce((total, line) => {
    return total + Math.max(1, Math.ceil(displayWidth(line) / perLine));
  }, 0);
}

function sheetNameOf(name) {
  const clean = String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return clean || 'Sheet1';
}

/* ============================ 工作簿 ============================ */
/**
 * buildWorkbook({ sheetName, headers, rows })
 *   headers: [{ title, width }]
 *   rows: Array<Array<{ v, link } | string | number>>
 *     link 存在时该单元格写入外部超链接（TargetMode=External）。
 */
function buildWorkbook(options) {
  const opts = options || {};
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  if (!headers.length) throw new Error('缺少表头');

  const cols = headers.map((h) => ({
    title: String((h && h.title) || ''),
    width: Number(h && h.width) > 0 ? Number(h.width) : 14,
  }));

  const hyperlinks = [];
  const sheetRows = [];

  const headerCells = cols.map((col, i) =>
    `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(col.title)}</t></is></c>`
  ).join('');
  sheetRows.push(`<row r="1" ht="26" customHeight="1">${headerCells}</row>`);

  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    let lines = 1;
    const cells = cols.map((col, colIndex) => {
      const cell = Array.isArray(row) ? row[colIndex] : null;
      const isObject = cell && typeof cell === 'object';
      const value = isObject ? cell.v : cell;
      const link = isObject ? cell.link : '';
      const text = value == null ? '' : String(value);
      if (!text) return '';
      const ref = `${colName(colIndex)}${r}`;
      if (link) hyperlinks.push({ ref, target: String(link) });
      lines = Math.max(lines, countLines(text, col.width));
      return `<c r="${ref}" t="inlineStr" s="${link ? 3 : 2}"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join('');
    const height = Math.min(409, Math.max(20, lines * 15 + 4));
    sheetRows.push(`<row r="${r}" ht="${height}" customHeight="1">${cells}</row>`);
  });

  const lastCol = colName(cols.length - 1);
  const lastRow = rows.length + 1;
  const colsXml = cols.map((col, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"/>`
  ).join('');

  const linksXml = hyperlinks.length
    ? `<hyperlinks>${hyperlinks.map((h, i) => `<hyperlink ref="${h.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>`
    : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${lastRow}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16"/>
<cols>${colsXml}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="A1:${lastCol}${lastRow}"/>
${linksXml}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

  const sheetRels = hyperlinks.length
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hyperlinks.map((h, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(h.target)}" TargetMode="External"/>`).join('\n')}
</Relationships>`
    : null;

  const sheetName = sheetNameOf(opts.sheetName);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color rgb="FF1C1C1E"/><name val="Microsoft YaHei"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Microsoft YaHei"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2563C9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFDDE2EB"/></left><right style="thin"><color rgb="FFDDE2EB"/></right><top style="thin"><color rgb="FFDDE2EB"/></top><bottom style="thin"><color rgb="FFDDE2EB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ];
  if (sheetRels) entries.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: sheetRels });

  return zip(entries, opts.createdAt ? new Date(opts.createdAt) : new Date());
}

module.exports = { buildWorkbook, xmlEscape, colName, crc32 };
