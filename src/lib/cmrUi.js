/**
 * Which part of the consignment note the driver is looking at.
 *
 * A CMR is filled in two moments — at the ramp and at the handover — and the panel shows one of
 * them at a time. The choice is derived from what has already been signed rather than from a
 * tab the driver has to pick, because a driver at the delivery point should not have to find
 * the right screen with a phone in one hand.
 */

export const STAGE_LABELS = {
  incarcare: 'Etapa încărcare',
  livrare: 'Etapa livrare',
};

export const DOC_TYPES = [
  { value: 'aviz', label: 'Aviz / cântar' },
  { value: 'cmr', label: 'Poză CMR' },
  { value: 'other', label: 'Alt document' },
];

/** Loading until it has been signed; delivery from then on, including after it is closed. */
export function currentStage(model) {
  return model?.stages?.incarcare?.signed_at ? 'livrare' : 'incarcare';
}

/** A signed stage is read-only: a consignment note is not edited after it has been signed. */
export function isStageLocked(model, stage) {
  return Boolean(model?.stages?.[stage]?.signed_at);
}

export function isFullySigned(model) {
  return Boolean(model?.stages?.livrare?.signed_at);
}

/** Draft → signed → closed, for the line under the heading. */
export function stageCaption(model) {
  const stage = currentStage(model);
  const state = isFullySigned(model)
    ? 'semnat complet'
    : isStageLocked(model, stage) ? 'semnat' : 'ciornă';
  return `${STAGE_LABELS[stage] ?? stage} · ${state}`;
}

function sortByBox(boxes) {
  return [...boxes].sort((a, b) => a.box - b.box);
}

/** The boxes the driver types into right now. */
export function editableBoxes(model, stage = currentStage(model)) {
  return sortByBox((model?.boxes ?? []).filter((b) => b.stage === stage));
}

/** What the office already knew — shown, never typed. */
export function prefillBoxes(model) {
  return sortByBox((model?.boxes ?? []).filter((b) => b.stage === 'prefill'));
}

/**
 * What was written at loading, once the driver has moved on to the delivery.
 *
 * Shown read-only rather than hidden: the reservations recorded at the ramp are exactly what a
 * driver needs in front of them while the consignee inspects the load.
 */
export function priorStageBoxes(model, stage = currentStage(model)) {
  if (stage !== 'livrare') return [];
  return sortByBox((model?.boxes ?? []).filter((b) => b.stage === 'incarcare'));
}

export function signatureBoxes(model, stage = currentStage(model)) {
  return (model?.signature_boxes ?? []).filter((s) => s.stage === stage);
}

/** A signature already given is displayed, not redrawn. */
export function isSigned(model, id) {
  const value = model?.signatures?.[id];
  return typeof value === 'string' && value.startsWith('/');
}

/**
 * Turns the server's refusal into something readable.
 *
 * The API answers an incomplete signature with the boxes it is missing; showing "CMR incomplet"
 * alone would leave the driver hunting for which one.
 */
export function missingLabels(err) {
  const missing = err?.data?.missing;
  if (!Array.isArray(missing) || missing.length === 0) return null;
  return missing.map((m) => m.label || m.id).join(', ');
}

/** Only signatures not already stored are sent, so an existing one is never overwritten. */
export function pendingSignatures(model, stage, pads) {
  const out = {};
  for (const box of signatureBoxes(model, stage)) {
    if (isSigned(model, box.id)) continue;
    const dataUrl = pads?.[box.id]?.toDataURL?.();
    if (dataUrl) out[box.id] = dataUrl;
  }
  return out;
}
