import { describe, expect, it } from 'vitest';
import { docsMissingTpo, refuseAnnexIfMergeMissingTpo } from './annexMergeTpoGate.js';

describe('annexMergeTpoGate', () => {
  it('docsMissingTpo treats blank and whitespace as missing', () => {
    expect(docsMissingTpo([
      { id: 'a', numar_tpo: 'TPO-1' },
      { id: 'b', numar_tpo: '' },
      { id: 'c', numar_tpo: '  ' },
      { id: 'd', numar_tpo: null },
    ]).map((d) => d.id)).toEqual(['b', 'c', 'd']);
  });

  it('no-ops when merge_tpo_cells is off', () => {
    expect(() => refuseAnnexIfMergeMissingTpo(
      [{ id: 'a', numar_tpo: null }],
      { options: { merge_tpo_cells: false } },
    )).not.toThrow();
  });

  it('refuses blank TPO when merge is ON — even conceptually with allow_unconfirmed', () => {
    const template = { options: { merge_tpo_cells: true } };
    try {
      refuseAnnexIfMergeMissingTpo(
        [
          { id: 'ok', numar_tpo: 'TPO-1', original_filename: 'ok.pdf' },
          { id: 'blank', numar_tpo: '', original_filename: 'blank.pdf' },
        ],
        template,
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('MERGE_TPO_REQUIRED');
      expect(err.message).toMatch(/Unește celulele TPO|Număr TPO/i);
      expect(err.blocked).toEqual([
        { id: 'blank', filename: 'blank.pdf', numar_tpo: '' },
      ]);
    }
  });

  it('allows export when every doc has TPO and merge is ON', () => {
    expect(() => refuseAnnexIfMergeMissingTpo(
      [{ id: 'a', numar_tpo: 'TPO-1' }, { id: 'b', numar_tpo: 'TPO-2' }],
      { options: { merge_tpo_cells: true } },
    )).not.toThrow();
  });

  it('skips goods-doc-only blank TPO when merge is ON', () => {
    expect(docsMissingTpo([
      { id: 'a', numar_tpo: '', extracted_data: { goods_doc_only: true } },
      { id: 'b', numar_tpo: '' },
    ]).map((d) => d.id)).toEqual(['b']);
    expect(() => refuseAnnexIfMergeMissingTpo(
      [
        { id: 'goods', numar_tpo: '', extracted_data: { goods_doc_only: true }, numar_document_marfa: 'TRO-0010722' },
        { id: 'ok', numar_tpo: 'TPO-1' },
      ],
      { options: { merge_tpo_cells: true } },
    )).not.toThrow();
  });
});
