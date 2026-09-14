/**
 * The official delimitation of Bucharest's heavy-vehicle access zones, as a tracing reference.
 *
 * These are street lists, not coordinates, because that is how the delimitation is actually
 * defined: PMB names the perimeter arteries and the boundary is the ring they form. No
 * machine-readable outline is published — OpenStreetMap carries no relation for these zones
 * either — so the outline in `tax_zones.polygon` has to be traced once, by a person, against
 * a basemap that labels these same streets.
 *
 * Nothing here is used by the calculation. It exists so that tracing follows the regulation
 * instead of a photograph, and so a boundary can be re-checked later against what it claims to
 * follow. Coordinates eyeballed off a scanned map would import cleanly and charge wrongly, and
 * nobody would find out until a customer disputed a zone fee.
 *
 * Source: Primăria Municipiului București — accesul autovehiculelor grele.
 */

export const BUCHAREST_ZONE_REFERENCE = {
  ZA: {
    label: 'Zona A',
    threshold: 'Acces restricționat peste 5,0 t MTMA, numai pe bază de autorizație',
    perimeter: [
      'Bd. Dacia', 'Str. Traian', 'Str. Nerva Traian', 'Bd. O. Goga', 'Pasaj Mărășești',
      'Bd. Mărășești', 'Str. Mitropolit Nifon', 'Bd. Libertății', 'Calea 13 Septembrie',
      'Șos. Pandurilor', 'Șos. Grozăvești', 'Șos. Orhideelor', 'Bd. Dinicu Golescu',
      'Piața Gării de Nord', 'Calea Griviței', 'Șos. N. Titulescu', 'Bd. Banu Manta',
      'Bd. I. Mihalache', 'Bd. Averescu', 'Bd. C-tin Prezan', 'Bd. Aviatorilor',
      'Bd. Mircea Eliade', 'Str. P. I. Ceaikovski', 'Str. B. Văcărescu', 'Str. Tunari',
    ],
  },
  ZB: {
    label: 'Zona B',
    threshold: 'Acces restricționat peste 7,5 t MTMA, numai pe bază de autorizație',
    perimeter: [
      'Bd. Aerogării', 'Str. Alex. Șerbănescu', 'Str. B. Văcărescu', 'Str. Fabrica de Glucoză',
      'Șos. Petricani', 'Str. Doamna Ghica', 'Șos. Colentina', 'Șos. Fundeni', 'Str. Morarilor',
      'Bd. Basarabia', 'Bd. 1 Decembrie 1918', 'Bd. Th. Pallady', 'Bd. Camil Ressu',
      'Str. Fizicienilor', 'Bd. Energeticienilor', 'Calea Vitan', 'Șos. Vitan Bârzești',
      'Str. Ion Iriceanu', 'Str. Turnu Măgurele', 'Str. Luică', 'Șos. Giurgiului',
      'Str. Alex. Anghel', 'Str. Zețarilor', 'Prelungirea Ferentari', 'Calea Ferentari',
      'Str. M. Sebastian', 'Calea 13 Septembrie', 'Bd. Ghencea', 'Str. Brașov', 'Șos. Virtuții',
      'Calea Crângași', 'Pasaj Grant', 'Calea Griviței', 'Bd. Bucureștii Noi', 'Str. Jiului',
      'Bd. Poligrafiei', 'Pasaj Jiului', 'Str. Băiculești', 'Șos. Străulești',
      'Bd. Ion Ionescu de la Brad',
    ],
  },
};

/**
 * The reference for a zone, matched on its code.
 *
 * Matching is deliberately narrow — exact code, case-insensitive — rather than fuzzy on the
 * name. Showing Zone A's perimeter next to a zone that merely happens to be called something
 * similar would guide a trace along the wrong ring.
 */
export function zoneReferenceFor(code) {
  const key = String(code || '').trim().toUpperCase();
  return BUCHAREST_ZONE_REFERENCE[key] ?? null;
}
