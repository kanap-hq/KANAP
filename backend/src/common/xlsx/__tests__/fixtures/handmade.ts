import AdmZip = require('adm-zip');

/**
 * Hand-made workbooks for the edge cases of the xlsx reader. Excel-authored files are not available
 * here: these parts are written the way Excel writes them (shared strings, `s` styles pointing to
 * `cellXfs`, custom `numFmt` codes, `date1904`), by hand, so each case is visible in the XML.
 */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface HandmadeParts {
  /** The `<sheetData>` content of the first worksheet. */
  sheetData: string;
  /** `<si>` items of the shared string table; omitted, the workbook has none. */
  sharedStrings?: readonly string[];
  /** `<numFmt>` elements and the `numFmtId` of each `cellXfs` entry; default: General only. */
  numFmts?: string;
  cellXfs?: readonly number[];
  /** `date1904="1"` in the workbook properties. */
  date1904?: boolean;
  /** Sheets before and after the first worksheet, as `<sheet>` elements with their relationships. */
  sheetsXml?: string;
  relsXml?: string;
  /** Parts added or replaced, by entry name. */
  parts?: Record<string, string | Buffer>;
}

export function workbookParts(options: HandmadeParts): Record<string, string | Buffer> {
  const sheetsXml = options.sheetsXml ?? `<sheet name="Data" sheetId="1" r:id="rId1"/>`;
  const relsXml =
    options.relsXml ??
    `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`;
  const parts: Record<string, string | Buffer> = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
    '_rels/.rels': `${HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><workbookPr${options.date1904 ? ' date1904="1"' : ''}/><sheets>${sheetsXml}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${HEAD}<Relationships xmlns="${PKG_REL}">${relsXml}<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/>${
      options.sharedStrings ? `<Relationship Id="rIdT" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ''
    }</Relationships>`,
    'xl/styles.xml': `${HEAD}<styleSheet xmlns="${MAIN}">${options.numFmts ? `<numFmts>${options.numFmts}</numFmts>` : ''}<fonts count="1"><font/></fonts><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs>${(options.cellXfs ?? [0])
      .map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)
      .join('')}</cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetData>${options.sheetData}</sheetData></worksheet>`,
  };
  if (options.sharedStrings) {
    parts['xl/sharedStrings.xml'] = `${HEAD}<sst xmlns="${MAIN}" count="${options.sharedStrings.length}" uniqueCount="${options.sharedStrings.length}">${options.sharedStrings.join('')}</sst>`;
  }
  return { ...parts, ...(options.parts ?? {}) };
}

export function zipOf(parts: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(parts)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

export function handmadeXlsx(options: HandmadeParts): Buffer {
  return zipOf(workbookParts(options));
}

/** Rewrites the uncompressed size an entry declares, in its local and central headers. */
export function declareSize(archive: Buffer, entryName: string, size: number): Buffer {
  const out = Buffer.from(archive);
  const name = Buffer.from(entryName, 'utf8');
  let patched = 0;
  for (let offset = 0; offset < out.length - 4; offset += 1) {
    const signature = out.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const nameLength = out.readUInt16LE(offset + 26);
      if (out.subarray(offset + 30, offset + 30 + nameLength).equals(name)) {
        out.writeUInt32LE(size, offset + 22);
        patched += 1;
      }
    } else if (signature === 0x02014b50) {
      const nameLength = out.readUInt16LE(offset + 28);
      if (out.subarray(offset + 46, offset + 46 + nameLength).equals(name)) {
        out.writeUInt32LE(size, offset + 24);
        patched += 1;
      }
    }
  }
  if (patched !== 2) throw new Error(`declareSize: ${patched} headers of ${entryName} rewritten`);
  return out;
}

/** A shared string item. */
export const si = (text: string): string => `<si><t xml:space="preserve">${text}</t></si>`;
