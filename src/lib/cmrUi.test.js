import { describe, expect, it } from 'vitest';
import {
  currentStage,
  editableBoxes,
  isFullySigned,
  isSigned,
  isStageLocked,
  missingLabels,
  pendingSignatures,
  prefillBoxes,
  priorStageBoxes,
  signatureBoxes,
  stageCaption,
} from './cmrUi.js';

const MODEL = {
  boxes: [
    { box: 11, id: 'greutate_bruta_kg', label: 'Greutate brută (kg)', stage: 'incarcare' },
    { box: 7, id: 'numar_colete', label: 'Număr de colete', stage: 'incarcare' },
    { box: 1, id: 'expeditor', label: 'Expeditor', stage: 'prefill' },
    { box: 18, id: 'rezerve_livrare', label: 'Rezerve la livrare', stage: 'livrare' },
  ],
  signature_boxes: [
    { box: 22, id: 'semnatura_expeditor', label: 'Semnătura expeditorului', stage: 'incarcare' },
    { box: 23, id: 'semnatura_transportator', label: 'Semnătura transportatorului', stage: 'incarcare' },
    { box: 24, id: 'semnatura_destinatar', label: 'Semnătura destinatarului', stage: 'livrare' },
  ],
  signatures: {},
  stages: { incarcare: { signed_at: null }, livrare: { signed_at: null } },
};

const LOADED = {
  ...MODEL,
  signatures: { semnatura_expeditor: '/uploads/a.png', semnatura_transportator: '/uploads/b.png' },
  stages: { incarcare: { signed_at: '2026-03-10T08:00:00Z' }, livrare: { signed_at: null } },
};

const CLOSED = {
  ...LOADED,
  signatures: { ...LOADED.signatures, semnatura_destinatar: '/uploads/c.png' },
  stages: { ...LOADED.stages, livrare: { signed_at: '2026-03-11T15:00:00Z' } },
};

describe('currentStage', () => {
  it('starts at loading', () => {
    expect(currentStage(MODEL)).toBe('incarcare');
  });

  it('moves to delivery once loading is signed, without the driver picking a tab', () => {
    expect(currentStage(LOADED)).toBe('livrare');
  });

  it('stays on delivery after the note is closed', () => {
    expect(currentStage(CLOSED)).toBe('livrare');
  });

  it('assumes loading when there is no note yet', () => {
    expect(currentStage(null)).toBe('incarcare');
  });
});

describe('locking', () => {
  it('locks a stage that has been signed', () => {
    expect(isStageLocked(LOADED, 'incarcare')).toBe(true);
    expect(isStageLocked(LOADED, 'livrare')).toBe(false);
  });

  it('knows when the whole note is closed', () => {
    expect(isFullySigned(CLOSED)).toBe(true);
    expect(isFullySigned(LOADED)).toBe(false);
  });
});

describe('stageCaption', () => {
  it('calls an unsigned note a draft', () => {
    expect(stageCaption(MODEL)).toBe('Etapa încărcare · ciornă');
  });

  it('says which stage is signed', () => {
    expect(stageCaption(LOADED)).toBe('Etapa livrare · ciornă');
  });

  it('says when nothing is left to sign', () => {
    expect(stageCaption(CLOSED)).toBe('Etapa livrare · semnat complet');
  });
});

describe('box selection', () => {
  it('shows only the current stage for editing', () => {
    expect(editableBoxes(MODEL).map((b) => b.id)).toEqual(['numar_colete', 'greutate_bruta_kg']);
  });

  it('orders boxes the way the paper form reads', () => {
    expect(editableBoxes(MODEL).map((b) => b.box)).toEqual([7, 11]);
  });

  it('separates what the office already knew', () => {
    expect(prefillBoxes(MODEL).map((b) => b.id)).toEqual(['expeditor']);
  });

  it('keeps the loading boxes visible during the delivery', () => {
    // The reservations written at the ramp are what the driver needs while the consignee looks
    // at the load.
    expect(priorStageBoxes(LOADED).map((b) => b.id)).toEqual(['numar_colete', 'greutate_bruta_kg']);
  });

  it('does not show prior boxes while still at loading', () => {
    expect(priorStageBoxes(MODEL)).toEqual([]);
  });

  it('picks the signatures for the stage in hand', () => {
    expect(signatureBoxes(MODEL).map((s) => s.id))
      .toEqual(['semnatura_expeditor', 'semnatura_transportator']);
    expect(signatureBoxes(LOADED).map((s) => s.id)).toEqual(['semnatura_destinatar']);
  });

  it('survives a model that has not loaded yet', () => {
    expect(editableBoxes(null)).toEqual([]);
    expect(prefillBoxes(undefined)).toEqual([]);
    expect(signatureBoxes(null)).toEqual([]);
  });
});

describe('signatures', () => {
  it('recognises a stored signature by its upload path', () => {
    expect(isSigned(LOADED, 'semnatura_expeditor')).toBe(true);
    expect(isSigned(MODEL, 'semnatura_expeditor')).toBe(false);
  });

  it('sends only the pads that were actually drawn on', () => {
    const pads = {
      semnatura_expeditor: { toDataURL: () => 'data:image/png;base64,AAA' },
      semnatura_transportator: { toDataURL: () => null },
    };
    expect(pendingSignatures(MODEL, 'incarcare', pads))
      .toEqual({ semnatura_expeditor: 'data:image/png;base64,AAA' });
  });

  it('never re-sends a signature that is already stored', () => {
    const pads = { semnatura_expeditor: { toDataURL: () => 'data:image/png;base64,AAA' } };
    expect(pendingSignatures(LOADED, 'incarcare', pads)).toEqual({});
  });

  it('handles a stage with no pads at all', () => {
    expect(pendingSignatures(MODEL, 'incarcare', {})).toEqual({});
    expect(pendingSignatures(MODEL, 'incarcare', undefined)).toEqual({});
  });
});

describe('missingLabels', () => {
  it('names the boxes the server refused on', () => {
    const err = { data: { missing: [{ id: 'greutate_bruta_kg', label: 'Greutate brută (kg)' }] } };
    expect(missingLabels(err)).toBe('Greutate brută (kg)');
  });

  it('falls back to the id when a label is missing', () => {
    expect(missingLabels({ data: { missing: [{ id: 'ceva' }] } })).toBe('ceva');
  });

  it('returns nothing for an error that is not about missing boxes', () => {
    expect(missingLabels(new Error('retea'))).toBeNull();
    expect(missingLabels({ data: { missing: [] } })).toBeNull();
  });
});
