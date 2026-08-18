const LINKEDIN_PATTERN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9%._~\-]+\/?/gi;

function normalizeLinkedIn(raw: string) {
  const value = raw.trim().replace(/[),.;]+$/, "");
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) return "";
    if (!/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function extractLinkedInUrls(text: string, max = 500) {
  const matches = text.match(LINKEDIN_PATTERN) || [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of matches) {
    const normalized = normalizeLinkedIn(match);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= max) break;
  }
  return urls;
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array) {
  if (!("DecompressionStream" in globalThis)) throw new Error("This browser cannot unpack Excel files. Save the sheet as CSV and upload it again.");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("The Excel file is not a valid XLSX archive.");
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();

  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const filename = decoder.decode(bytes.slice(offset + 46, offset + 46 + filenameLength));

    if (view.getUint32(localOffset, true) === 0x04034b50) {
      const localFilenameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (compression === 0) files.set(filename, compressed);
      else if (compression === 8) files.set(filename, await inflateRaw(compressed));
    }
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  return files;
}

function xmlText(bytes?: Uint8Array) {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t")).map((node) => node.textContent || "").join(""),
  );
}

function sheetValues(xml: string, sharedStrings: string[]) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const values: string[] = [];
  for (const cell of Array.from(doc.getElementsByTagName("c"))) {
    const type = cell.getAttribute("t") || "";
    if (type === "inlineStr") {
      const text = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
      if (text) values.push(text);
      continue;
    }
    const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
    if (!raw) continue;
    if (type === "s") values.push(sharedStrings[Number(raw)] || "");
    else values.push(raw);
  }
  return values;
}

async function extractFromXlsx(file: File) {
  const files = await unzipEntries(await file.arrayBuffer());
  const sharedStrings = parseSharedStrings(xmlText(files.get("xl/sharedStrings.xml")));
  const sheetNames = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  if (!sheetNames.length) throw new Error("No worksheet was found in this Excel file.");
  const collected: string[] = [];
  for (const sheetName of sheetNames.slice(0, 5)) {
    collected.push(...sheetValues(xmlText(files.get(sheetName)), sharedStrings));
  }
  return extractLinkedInUrls(collected.join("\n"));
}

export async function extractLinkedInUrlsFromFile(file: File) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return extractFromXlsx(file);
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    return extractLinkedInUrls(await file.text());
  }
  throw new Error("Upload CSV, TSV, TXT, or XLSX. The importer will find the LinkedIn profile column automatically.");
}
