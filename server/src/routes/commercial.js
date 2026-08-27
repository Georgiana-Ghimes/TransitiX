/**
 * The commercial configuration behind every TPO: contracts, tariffs, zone taxes, surcharges,
 * observation codes and the depot.
 *
 * All of it was already editable through the generic entities API and through nothing else,
 * which meant the pricing engine was configurable only by whoever could write SQL. This route
 * exists so one screen can load the whole picture, and — more importantly — so the warnings it
 * shows come from the same functions the calculation uses. A tariff screen that decides for
 * itself what "valid" means is how a rate reads as active on screen and is skipped in the TPO.
 */
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { pool, query, withTransaction } from '../db.js';
import { authRequired, officeRequired, adminRequired } from '../middleware/auth.js';
import { serializeRow } from '../entities.js';
import { findOverlaps, findTariff, tariffHistory } from '../lib/pricing/tariffs.js';
import { parseCodeRows } from '../lib/pricing/codeImport.js';
import { actorFrom, recordAudit } from '../lib/audit/events.js';
import { createLogger } from '../lib/log.js';

const log = createLogger({ scope: 'commercial' });

const router = Router();
router.use(authRequired, officeRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function fail(res, err, fallback) {
  const status = err?.status || 500;
  if (status >= 500) log.error('eroare', err);
  res.status(status).json({ message: err?.message || fallback });
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Everything the configuration screen needs, in one call.
 *
 * Overlapping validity periods are computed here with `findOverlaps` rather than in the browser:
 * an overlap is not an error — the newest still wins — but it is almost always a forgotten
 * `valid_to`, and the screen has to name it in the same terms the calculation would.
 */
router.get('/overview', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const [
      clients, contracts, tariffs, zones, zoneRates, surchargeTypes, surchargeRates,
      codes, company, locations, vehicleClasses,
    ] = await Promise.all([
      query('SELECT id, name FROM clients WHERE company_id = $1 ORDER BY name', [companyId]),
      query('SELECT * FROM contracts WHERE company_id = $1 ORDER BY is_active DESC, code', [companyId]),
      query('SELECT * FROM contract_tariffs WHERE company_id = $1 ORDER BY valid_from DESC', [companyId]),
      query('SELECT * FROM tax_zones WHERE company_id = $1 ORDER BY priority DESC, code', [companyId]),
      query('SELECT * FROM tax_zone_rates WHERE company_id = $1 ORDER BY mma_min_kg NULLS FIRST', [companyId]),
      query('SELECT * FROM surcharge_types WHERE company_id = $1 ORDER BY code', [companyId]),
      query('SELECT * FROM surcharge_rates WHERE company_id = $1 ORDER BY valid_from DESC', [companyId]),
      query('SELECT * FROM aviz_observation_codes WHERE company_id = $1 ORDER BY sort_order, code', [companyId]),
      query('SELECT default_depot_location_id FROM companies WHERE id = $1', [companyId]),
      query('SELECT id, name, city, county, latitude, longitude FROM locations WHERE company_id = $1 ORDER BY name', [companyId]),
      query(`SELECT DISTINCT vehicle_class FROM vehicles
             WHERE company_id = $1 AND vehicle_class IS NOT NULL AND vehicle_class <> ''
             ORDER BY vehicle_class`, [companyId]),
    ]);

    const byContract = new Map();
    for (const row of tariffs.rows) {
      if (!byContract.has(row.contract_id)) byContract.set(row.contract_id, []);
      byContract.get(row.contract_id).push(row);
    }

    const on = today();
    const contractRows = contracts.rows.map((contract) => {
      const rows = byContract.get(contract.id) ?? [];
      const classes = [...new Set(rows.map((r) => r.vehicle_class))];
      return {
        ...serializeRow(contract),
        tariff_count: rows.length,
        overlaps: findOverlaps(rows).map(({ a, b }) => ({
          vehicle_class: a.vehicle_class, a: a.id, b: b.id,
        })),
        // Which classes have nothing in force today. A contract that looks configured but
        // prices nothing is the failure this screen exists to surface.
        classes_without_current_tariff: classes.filter(
          (vehicleClass) => !findTariff(rows, { vehicleClass, onDate: on })
        ),
      };
    });

    res.json({
      clients: clients.rows,
      contracts: contractRows,
      tariffs: tariffs.rows.map(serializeRow),
      zones: zones.rows.map(serializeRow),
      zone_rates: zoneRates.rows.map(serializeRow),
      surcharge_types: surchargeTypes.rows.map(serializeRow),
      surcharge_rates: surchargeRates.rows.map(serializeRow),
      observation_codes: codes.rows.map(serializeRow),
      depot_location_id: company.rows[0]?.default_depot_location_id ?? null,
      locations: locations.rows.map(serializeRow),
      // The classes actually in the fleet, so a tariff cannot be written for a band nobody drives.
      fleet_vehicle_classes: vehicleClasses.rows.map((r) => r.vehicle_class),
      on_date: on,
    });
  } catch (err) {
    fail(res, err, 'Configurarea nu a putut fi citită');
  }
});

/** The history for one class on one contract, oldest change last. */
router.get('/contracts/:id/history', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM contract_tariffs WHERE company_id = $1 AND contract_id = $2',
      [req.user.company_id, req.params.id]
    );
    const vehicleClass = String(req.query.vehicle_class || '');
    res.json({
      history: tariffHistory(rows.rows, vehicleClass).map(serializeRow),
      current: serializeRow(findTariff(rows.rows, { vehicleClass, onDate: today() })) ?? null,
    });
  } catch (err) {
    fail(res, err, 'Istoricul nu a putut fi citit');
  }
});

/** The depot every trip's kilometres start and end at. */
router.put('/depot', adminRequired, async (req, res) => {
  try {
    const locationId = req.body?.location_id ?? null;
    if (locationId) {
      const found = await query(
        'SELECT id, latitude, longitude FROM locations WHERE id = $1 AND company_id = $2',
        [locationId, req.user.company_id]
      );
      if (!found.rows[0]) return res.status(404).json({ message: 'Locație inexistentă' });
      if (found.rows[0].latitude == null || found.rows[0].longitude == null) {
        // Without coordinates the round trip cannot be measured, and the TPO silently loses its
        // kilometre component — better to refuse than to accept a depot that cannot be routed.
        return res.status(422).json({
          message: 'Locația nu are coordonate. Geocodeaz-o din ecranul Locații înainte de a o '
            + 'seta ca garaj — fără coordonate nu se pot calcula kilometrii.',
        });
      }
    }
    // Read before writing: moving the garage silently changes every billable kilometre computed
    // afterwards, and "when did the depot move?" is unanswerable without the previous value.
    const before = (await query(
      'SELECT default_depot_location_id FROM companies WHERE id = $1',
      [req.user.company_id]
    )).rows[0]?.default_depot_location_id ?? null;

    await query(
      'UPDATE companies SET default_depot_location_id = $1, updated_at = NOW() WHERE id = $2',
      [locationId, req.user.company_id]
    );

    if (before !== locationId) {
      const named = async (id) => (id ? (await query(
        'SELECT name FROM locations WHERE id = $1 AND company_id = $2',
        [id, req.user.company_id]
      )).rows[0]?.name ?? null : null);
      try {
        await recordAudit(pool, {
          company_id: req.user.company_id,
          action: 'update',
          entity: 'Depot',
          entity_id: locationId,
          label: await named(locationId),
          changes: {
            default_depot_location_id: {
              from: await named(before) || before,
              to: await named(locationId) || locationId,
            },
          },
          ...actorFrom(req),
        });
      } catch (auditErr) {
        // The depot is already saved. Failing the request now would tell the user the save did
        // not happen, which would be a lie.
        log.error('nu am putut înregistra mutarea garajului', auditErr);
      }
    }

    res.json({ depot_location_id: locationId });
  } catch (err) {
    fail(res, err, 'Garajul nu a putut fi salvat');
  }
});

/** Reads a sheet of the customer's own observation codes. */
router.post('/observation-codes/import', adminRequired, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ message: uploadErr.message || 'Încărcare eșuată' });
    if (!req.file) return res.status(400).json({ message: 'Niciun fișier trimis' });

    try {
      const rows = await readSheet(req.file);
      const { codes, skipped, error } = parseCodeRows(rows);
      if (error) return res.status(422).json({ message: error, skipped });
      if (!codes.length) return res.status(422).json({ message: 'Niciun cod în fișier.', skipped });

      // A preview run so an operator sees what is about to happen before it happens.
      if (req.body?.dry_run === 'true') {
        return res.json({ dry_run: true, codes, skipped, imported: 0 });
      }

      const imported = await withTransaction(async (client) => {
        let count = 0;
        for (const code of codes) {
          await client.query(
            `INSERT INTO aviz_observation_codes (company_id, code, label, kind, sort_order, is_active)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (company_id, code) DO UPDATE
               SET label = EXCLUDED.label, kind = EXCLUDED.kind,
                   sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active`,
            [req.user.company_id, code.code, code.label, code.kind, code.sort_order, code.is_active]
          );
          count += 1;
        }
        return count;
      });

      res.json({ imported, skipped, codes });
    } catch (err) {
      fail(res, err, 'Importul a eșuat');
    }
  });
});

/** Rows out of an .xlsx or a .csv, as arrays of cell values. */
async function readSheet(file) {
  const isCsv = /\.csv$/i.test(file.originalname) || file.mimetype === 'text/csv';
  if (isCsv) {
    return file.buffer
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.split(/[,;]/).map((cell) => cell.trim().replace(/^"|"$/g, '')));
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw Object.assign(new Error('Fișierul nu conține nicio foaie'), { status: 422 });

  const rows = [];
  sheet.eachRow((row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      values.push(cell.value === null || cell.value === undefined ? '' : String(cell.text ?? cell.value));
    });
    rows.push(values);
  });
  return rows;
}

export default router;
