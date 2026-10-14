/**
 * Builds synthetic annex rows + sample XLSX files to exercise „Unește celulele TPO”.
 *
 *   node qa/samples/merge-tpo/build-fixture.mjs
 *
 * Writes:
 *   qa/samples/merge-tpo/fixture-avize.json
 *   qa/samples/merge-tpo/anexa-merge-ON.xlsx
 *   qa/samples/merge-tpo/anexa-merge-OFF.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RAI_COLUMNS, annexFieldDefaults } from '../../../server/src/lib/avizTemplate.js';
import { buildReport } from '../../../server/src/lib/reporting/build.js';
import { renderReportWorkbook } from '../../../server/src/lib/avizExport.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** One TPO with 3 curse, then another TPO with 2, then a singleton — classic Baumit layout. */
export function buildMergeTpoFixtureAvize() {
  const base = annexFieldDefaults();
  return [
    {
      ...base,
      id: 'fix-tpo-a-1',
      numar_tpo: 'TPO-MERGE-9001',
      data_efectuare_cursa: '2026-10-07',
      numar_auto: 'B-11-AAA',
      ruta_transport: 'Bolintin-Deal / Ciulnita',
      tip_marfa: 'saci',
      cantitate_marfa: 100,
      gross_weight_kg: 24000,
      numar_document_marfa: 'PSL-9001-A',
      status: 'confirmed',
    },
    {
      ...base,
      id: 'fix-tpo-a-2',
      numar_tpo: 'TPO-MERGE-9001',
      data_efectuare_cursa: '2026-10-07',
      numar_auto: 'B-22-BBB',
      ruta_transport: 'Bolintin-Deal / Ciulnita',
      tip_marfa: 'saci',
      cantitate_marfa: 120,
      gross_weight_kg: 25000,
      numar_document_marfa: 'PSL-9001-B',
      status: 'confirmed',
    },
    {
      ...base,
      id: 'fix-tpo-a-3',
      numar_tpo: 'TPO-MERGE-9001',
      data_efectuare_cursa: '2026-10-08',
      numar_auto: 'B-33-CCC',
      ruta_transport: 'Bolintin-Deal / Pantelimon',
      tip_marfa: 'galeti',
      cantitate_marfa: 80,
      gross_weight_kg: 18000,
      numar_document_marfa: 'TRO-9001-C',
      status: 'confirmed',
    },
    {
      ...base,
      id: 'fix-tpo-b-1',
      numar_tpo: 'TPO-MERGE-9002',
      data_efectuare_cursa: '2026-10-09',
      numar_auto: 'B-44-DDD',
      ruta_transport: 'Chiajna / Bucuresti',
      tip_marfa: 'saci',
      cantitate_marfa: 90,
      gross_weight_kg: 20000,
      numar_document_marfa: 'PSL-9002-A',
      status: 'confirmed',
    },
    {
      ...base,
      id: 'fix-tpo-b-2',
      numar_tpo: 'TPO-MERGE-9002',
      data_efectuare_cursa: '2026-10-09',
      numar_auto: 'B-55-EEE',
      ruta_transport: 'Chiajna / Bucuresti',
      tip_marfa: 'saci',
      cantitate_marfa: 95,
      gross_weight_kg: 21000,
      numar_document_marfa: 'PSL-9002-B',
      status: 'confirmed',
    },
    {
      ...base,
      id: 'fix-tpo-solo',
      numar_tpo: 'TPO-MERGE-9003',
      data_efectuare_cursa: '2026-10-10',
      numar_auto: 'B-66-FFF',
      ruta_transport: 'Otopeni / Pipera',
      tip_marfa: 'm3',
      cantitate_marfa: 12,
      gross_weight_kg: 12000,
      numar_document_marfa: 'PSL-9003',
      status: 'confirmed',
    },
  ];
}

async function writeXlsx(filename, mergeTpoCells) {
  const avize = buildMergeTpoFixtureAvize();
  const template = {
    name: 'Baumit merge-TPO fixture',
    columns: DEFAULT_RAI_COLUMNS,
    options: { merge_tpo_cells: mergeTpoCells },
  };
  const report = buildReport({ template, documents: avize });
  const workbook = renderReportWorkbook({
    name: template.name,
    columns: report.columns,
    rows: report.rows,
    totals: null,
    mergeTpoCells,
  });
  const out = path.join(HERE, filename);
  await workbook.xlsx.writeFile(out);
  return out;
}

async function main() {
  fs.mkdirSync(HERE, { recursive: true });
  const avize = buildMergeTpoFixtureAvize();
  const jsonPath = path.join(HERE, 'fixture-avize.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify({
    purpose: 'Unește celulele TPO — 3 curse pe TPO-9001, 2 pe TPO-9002, 1 pe TPO-9003',
    avize,
  }, null, 2)}\n`);

  const on = await writeXlsx('anexa-merge-ON.xlsx', true);
  const off = await writeXlsx('anexa-merge-OFF.xlsx', false);
  process.stdout.write(
    `Wrote:\n  ${jsonPath}\n  ${on}\n  ${off}\n`
    + `Expected ON: merge TPO-MERGE-9001 rows 2-4, TPO-MERGE-9002 rows 5-6; 9003 alone.\n`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
