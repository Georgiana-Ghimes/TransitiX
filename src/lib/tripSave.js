/** Omit status on trip update when the dispatcher did not change the select. */
export function tripStatusForOfficeSave(openedStatus, formStatus) {
  if (formStatus == null || formStatus === '') return undefined;
  if (openedStatus === formStatus) return undefined;
  return formStatus;
}
