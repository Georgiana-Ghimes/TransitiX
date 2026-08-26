/**
 * The consignment note as a printable page.
 *
 * Kept apart from the PDF writer so the layout can be tested without a browser, and so the
 * rasterizer has one job. Styles are inline and deliberately plain — the renderer understands
 * only basic CSS, and nothing here may depend on the app's stylesheet.
 *
 * The point of the sheet is that a driver can hand it over or show it at a check. That is also
 * why an unsigned note prints as visibly unsigned: a page that looks like a completed CMR when
 * nobody has signed it is worse than no page at all.
 */

const COLORS = {
  ink: '#0A2B4E',
  muted: '#64748B',
  line: '#94A3B8',
  head: '#E2E8F0',
  warn: '#B45309',
  warnBg: '#FEF3C7',
};

/** A4 portrait at 96dpi, the size the rasterizer works in. */
export const PAGE = { width: 794, height: 1123 };

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Keeps operator line breaks, which is how reservations are usually written. */
function multiline(value) {
  const text = escapeHtml(value ?? '').trim();
  return text ? text.replace(/\n/g, '<br>') : '&nbsp;';
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return escapeHtml(value);
  return num.toLocaleString('ro-RO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDate(value) {
  const text = String(value ?? '').slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : escapeHtml(value ?? '');
}

/**
 * What the sheet must say about itself at the top.
 *
 * A note signed at both ends is a document. Anything less is a draft, and the page says which —
 * printed and handed over, the difference is the whole point.
 */
export function sheetState(model) {
  const loading = Boolean(model?.stages?.incarcare?.signed_at);
  const delivery = Boolean(model?.stages?.livrare?.signed_at);
  if (loading && delivery) return { kind: 'complete', label: 'Semnat la încărcare și la livrare' };
  if (loading) return { kind: 'partial', label: 'Semnat la încărcare · livrarea nesemnată' };
  return { kind: 'draft', label: 'CIORNĂ — nesemnată' };
}

function box(number, label, content, { grow = false, minHeight = 54 } = {}) {
  return `<div style="border:1px solid ${COLORS.line};padding:4px 6px;${grow ? 'flex:1;' : ''}min-height:${minHeight}px;box-sizing:border-box">
    <div style="font-size:8px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:.3px">${escapeHtml(number)}. ${escapeHtml(label)}</div>
    <div style="font-size:11px;color:${COLORS.ink};line-height:1.35;margin-top:2px">${content}</div>
  </div>`;
}

function signatureBox(number, label, url, when) {
  const image = url
    ? `<img src="${escapeHtml(url)}" alt="" style="max-height:44px;max-width:100%;object-fit:contain;display:block">`
    : `<div style="height:44px;border-bottom:1px dashed ${COLORS.line}"></div>`;
  const stamp = when
    ? `<div style="font-size:8px;color:${COLORS.muted};margin-top:2px">${escapeHtml(when)}</div>`
    : '';
  return `<div style="border:1px solid ${COLORS.line};padding:4px 6px;flex:1;box-sizing:border-box">
    <div style="font-size:8px;color:${COLORS.muted};text-transform:uppercase">${escapeHtml(number)}. ${escapeHtml(label)}</div>
    ${image}${stamp}
  </div>`;
}

function goodsTable(data) {
  const cells = [
    ['6. Mărci și numere', escapeHtml(data.marci_si_numere ?? '')],
    ['7. Nr. colete', formatNumber(data.numar_colete)],
    ['8. Mod de ambalare', escapeHtml(data.mod_ambalare ?? '')],
    ['9. Natura mărfii', escapeHtml(data.natura_marfii ?? '')],
    ['10. Nr. statistic', escapeHtml(data.cod_nhm ?? '')],
    ['11. Greutate brută (kg)', formatNumber(data.gross ?? data.greutate_bruta_kg)],
    ['12. Volum (m³)', formatNumber(data.volum_mc, 2)],
  ];
  const head = cells
    .map(([title]) => `<th style="border:1px solid ${COLORS.line};background:${COLORS.head};font-size:8px;color:${COLORS.muted};font-weight:600;padding:3px 4px;text-align:left">${escapeHtml(title)}</th>`)
    .join('');
  const body = cells
    .map(([, value]) => `<td style="border:1px solid ${COLORS.line};font-size:11px;color:${COLORS.ink};padding:5px 4px;vertical-align:top">${value || '&nbsp;'}</td>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>${head}</tr></thead><tbody><tr>${body}</tr></tbody></table>`;
}

function bannerHtml(state) {
  if (state.kind === 'complete') return '';
  return `<div style="border:1px solid ${COLORS.warn};background:${COLORS.warnBg};color:${COLORS.warn};font-size:11px;font-weight:600;padding:5px 8px;margin-bottom:6px">
    ${escapeHtml(state.label)}
  </div>`;
}

/**
 * The whole page.
 *
 * @param {object} model  the `/api/cmr/trips/:id` payload
 * @param {object} [opts] `signatureUrl` maps a stored path to something the renderer can load
 */
export function cmrSheetHtml(model, { signatureUrl = (u) => u, printedAt = new Date() } = {}) {
  const data = model?.data ?? {};
  const signatures = model?.signatures ?? {};
  const state = sheetState(model);
  const number = model?.trip?.cmr_number ?? '';

  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO') : '');

  return `<div style="width:${PAGE.width}px;min-height:${PAGE.height}px;background:#fff;padding:24px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div>
        <div style="font-size:16px;font-weight:700;color:${COLORS.ink}">SCRISOARE DE TRANSPORT — CMR</div>
        <div style="font-size:10px;color:${COLORS.muted}">Lettre de voiture internationale · Convenția CMR</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:700;color:${COLORS.ink}">${escapeHtml(number)}</div>
        <div style="font-size:9px;color:${COLORS.muted}">Tipărit ${escapeHtml(printedAt.toLocaleString('ro-RO'))}</div>
      </div>
    </div>

    ${bannerHtml(state)}

    <div style="display:flex;gap:6px;margin-bottom:6px">
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        ${box(1, 'Expeditor', multiline(data.expeditor))}
        ${box(2, 'Destinatar', multiline(data.destinatar))}
        ${box(3, 'Locul livrării mărfii', multiline(data.loc_livrare))}
        ${box(4, 'Locul și data încărcării', multiline(data.loc_data_incarcare))}
        ${box(5, 'Documente anexate', multiline(data.documente_anexate))}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        ${box(16, 'Transportator', multiline(data.transportator))}
        ${box(17, 'Transportatori succesivi', multiline(data.transportatori_succesivi))}
        ${box(18, 'Rezerve și observații la încărcare', multiline(data.rezerve_incarcare), { minHeight: 74 })}
        ${box(18, 'Rezerve și observații la livrare', multiline(data.rezerve_livrare), { minHeight: 74 })}
      </div>
    </div>

    <div style="margin-bottom:6px">${goodsTable(data)}</div>

    <div style="display:flex;gap:6px;margin-bottom:6px">
      ${box(13, 'Instrucțiunile expeditorului', multiline(data.instructiuni_expeditor), { grow: true })}
      ${box(19, 'Convenții speciale', multiline(data.conventii_speciale), { grow: true })}
    </div>

    <div style="display:flex;gap:6px;margin-bottom:6px">
      ${box(21, 'Întocmit la', `${escapeHtml(data.intocmit_la ?? '')}${data.intocmit_data ? ` · ${formatDate(data.intocmit_data)}` : ''}`, { grow: true, minHeight: 40 })}
    </div>

    <div style="display:flex;gap:6px">
      ${signatureBox(22, 'Semnătura expeditorului', signatureUrl(signatures.semnatura_expeditor), stamp(model?.stages?.incarcare?.signed_at))}
      ${signatureBox(23, 'Semnătura transportatorului', signatureUrl(signatures.semnatura_transportator), stamp(model?.stages?.incarcare?.signed_at))}
      ${signatureBox(24, 'Semnătura destinatarului', signatureUrl(signatures.semnatura_destinatar), stamp(model?.stages?.livrare?.signed_at))}
    </div>

    <div style="font-size:8px;color:${COLORS.muted};margin-top:10px">
      Document generat electronic din Transitix. Semnăturile sunt capturate pe dispozitivul
      șoferului și păstrate împreună cu cursa.
    </div>
  </div>`;
}

/** The filename the browser gets, safe on every platform. */
export function cmrSheetFilename(model) {
  const number = String(model?.trip?.cmr_number || 'CMR').replace(/[^\w-]+/g, '_').slice(0, 40);
  return `CMR-${number}.pdf`;
}
