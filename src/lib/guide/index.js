/**
 * Which guide a person gets.
 *
 * Driven by the role and by the build profile, not by which screen somebody happened to open.
 * A driver and an administrator do not need the same document written at different lengths,
 * they need different documents: one is a procedure carried out in a cab, the other is a
 * reference consulted at a desk with a customer waiting.
 */
import { isDriverRole } from '../roles.js';
import { isDocumentsProfile } from '../appProfile.js';
import { DRIVER_GUIDE } from './driverGuide.js';
import { officeGuide } from './officeGuide.js';

export { searchSections, sectionText } from './schema.js';
export { DRIVER_GUIDE } from './driverGuide.js';
export { officeGuide } from './officeGuide.js';

/**
 * `role` and `companion` are parameters rather than read from context here, so the choice can
 * be tested without a React tree and so a screen can ask for a specific guide when it knows
 * better than the ambient profile.
 */
export function guideFor({ role, companion } = {}) {
  if (isDriverRole(role)) return DRIVER_GUIDE;
  const asCompanion = companion === undefined ? isDocumentsProfile() : Boolean(companion);
  return officeGuide({ companion: asCompanion });
}

/** Total sections, used by the screen to say how much is hidden behind a search. */
export function guideSectionCount(guide) {
  return (guide?.sections ?? []).length;
}
