import fs from 'fs';
import path from 'path';

const LOGISTICS = /\b(?:TPO|PSL|TRO|TP0|TPQ)[\s\-._]*\d{3,}/i;
const PLATE = /\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)[\s\-]?[0-9]{2,3}[\s\-]?[A-Z]{2,3}\b/i;
const WEIGHT = /\b\d{1,3}([.,]\d{3})?\s*(kg|t)\b|\b\d{4,5}\b/i;
const DIACRITIC = /[ăâîșțĂÂÎȘȚ]/g;

function score(text) {
  const t = String(text || '');
  const codes = [...t.matchAll(new RegExp(LOGISTICS.source, 'gi'))].map((m) => m[0]);
  const plates = [...t.matchAll(new RegExp(PLATE.source, 'gi'))].map((m) => m[0]);
  const dia = (t.match(DIACRITIC) || []).length;
  return {
    chars: t.trim().length,
    logistics: [...new Set(codes.map((c) => c.toUpperCase().replace(/\s+/g, '')))],
    plates: [...new Set(plates.map((p) => p.toUpperCase().replace(/\s+/g, ' ')))],
    hasWeightHint: WEIGHT.test(t),
    diacritics: dia,
    preview: t.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

async function ocr(base, filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300_000);
  try {
    const res = await fetch(`${base}/ocr/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: buf.toString('base64'), mime_type: mime }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, status: res.status, text: '' };
    const json = await res.json();
    return { ok: true, ms, text: String(json?.text || ''), pages: json?.total_pages || json?.pages || 1 };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.name || String(err), text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

const files = process.argv.slice(2);
const engines = [
  { name: 'paddle', url: 'http://127.0.0.1:8100' },
  { name: 'paddle-vl', url: 'http://127.0.0.1:8101' },
];

const report = [];
for (const file of files) {
  const label = path.basename(file).replace(/^c-[a-f0-9-]+-\d+-[a-f0-9-]+-/, '');
  console.log(`\n==== ${label} ====`);
  const row = { file: label, engines: {} };
  for (const eng of engines) {
    process.stdout.write(`  ${eng.name}... `);
    const r = await ocr(eng.url, file, mimeFor(file));
    const s = score(r.text);
    row.engines[eng.name] = { ok: r.ok, ms: r.ms, error: r.error || null, status: r.status || null, ...s };
    console.log(
      `${r.ok ? 'ok' : 'FAIL'} ${r.ms}ms chars=${s.chars} codes=${s.logistics.join(',') || '-'} plates=${s.plates.join(',') || '-'}`,
    );
    if (s.preview) console.log('   ', s.preview);
    if (!r.ok) console.log('    err=', r.error || r.status);
  }
  report.push(row);
}

const out = path.join('tools', 'ocr-bench-out', `paddle-vl-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\nWrote', out);
