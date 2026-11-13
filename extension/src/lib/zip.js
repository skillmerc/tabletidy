// Reused unchanged from List & Table Scraper 1.2.0 (pre-contest work, SKILLMERC). See README 'Built during the contest'.
// Minimal ZIP writer (store method, no compression). Pure JS, no dependencies.
// Produces a valid PKZIP archive readable by every unzip tool and python's zipfile.
// Transcripts are small text files, so skipping deflate keeps this at ~60 lines.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

/**
 * files: [{ name: "a/b.txt", data: string | Uint8Array }]
 * returns Uint8Array of the archive.
 */
export function createZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: ddate } = dosDateTime(date);
  const parts = [], central = [];
  let offset = 0;
  const seen = new Set();
  for (const f of files) {
    let name = String(f.name).replace(/\\/g, "/").replace(/^\/+/, "");
    let base = name, n = 1;
    while (seen.has(name)) { const m = base.match(/^(.*?)(\.[^./]+)?$/); name = `${m[1]} (${n++})${m[2] || ""}`; }
    seen.add(name);
    const nameBytes = enc.encode(name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800) /* UTF-8 names */, ...u16(0) /* store */,
      ...u16(time), ...u16(ddate), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    parts.push(Uint8Array.from(local), nameBytes, data);
    central.push(Uint8Array.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(ddate), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of [...parts, ...central, eocd]) { out.set(chunk, p); p += chunk.length; }
  return out;
}
