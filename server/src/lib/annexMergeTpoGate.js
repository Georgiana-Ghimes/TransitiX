import { wantsMergeTpoCells } from './templateOptions.js';

/** Explicit operator flag: transfer / goods page with no transport TPO. */
export function isGoodsDocOnly(doc) {
  return Boolean(doc?.extracted_data?.goods_doc_only);
}

/** Docs with blank / whitespace-only numar_tpo (excluding goods-doc-only). */
export function docsMissingTpo(docs) {
  return (docs || []).filter((d) => (
    !String(d?.numar_tpo || '').trim()
    && !isGoodsDocOnly(d)
  ));
}

/**
 * When „Unește celulele TPO” is on, blank numar_tpo cannot enter the annex —
 * even with allow_unconfirmed. Goods-doc-only rows (TRO/PSL, no TPO) are allowed
 * and sort to the bottom of the merged annex.
 *
 * @throws {{ status: number, code: string, blocked: object[] }}
 */
export function refuseAnnexIfMergeMissingTpo(docs, template) {
  if (!wantsMergeTpoCells(template)) return;
  const blank = docsMissingTpo(docs);
  if (!blank.length) return;
  const n = blank.length;
  const err = new Error(
    n === 1
      ? 'Unește celulele TPO e activ: completează Număr TPO pe documentul fără TPO înainte de anexă (sau marchează „Doar document marfă”, sau oprește bifa pe șablon).'
      : `Unește celulele TPO e activ: ${n} documente fără Număr TPO. Completează TPO sau marchează „Doar document marfă” înainte de anexă.`,
  );
  err.status = 409;
  err.code = 'MERGE_TPO_REQUIRED';
  err.blocked = blank.map((d) => ({
    id: d.id,
    filename: d.original_filename,
    numar_tpo: d.numar_tpo ?? null,
  }));
  throw err;
}
