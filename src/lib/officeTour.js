/** First-visit office intro. Reopened from the sidebar Ghid control. */

export const OFFICE_TOUR_SEEN_KEY = 'transitix_office_tour_seen';

/** @typedef {'dashboard' | 'ghid'} TourHighlightTarget */

export const OFFICE_TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Bine ai venit — aici e biroul tău',
    body:
      'Ești pe Dashboard, pagina de start. Sus vezi patru numere: câte mașini ai, câți șoferi activi, câte curse sunt în drum și dacă ai alerte la documente (ITP, RCA, permis). Mai jos: graficul cu cursele pe status și lista ultimelor transporturi. Meniul din stânga te duce la restul aplicației — îl parcurgem la următorii pași.',
    mobileBody:
      'Pe telefon, Dashboard e tot pagina de start. Derulează în sus: vezi patru casete (mașini, șoferi, curse active, alerte documente), apoi graficul și ultimele curse. Restul aplicației e în meniul ☰ sus-stânga.',
    path: '/',
    highlightTarget: 'dashboard',
    hint: 'Privește zona evidențiată din dreapta — acolo e rezumatul zilei, nu meniul.',
    mobileHint: 'Derulează pagina din spatele ghidului — acolo sunt cifrele zilei.',
  },
  {
    id: 'avize',
    title: 'Avize → Excel pentru facturare (RAI)',
    body:
      'Aici aduci avizele de la șantier — PDF sau poză. Programul citește TPO, dată, număr auto și rută; tu completezi km, taxe, tarif și observații. Bifezi ce e corect și apeși Unește: primești fișierul Anexa Factură (Excel). Pentru colegii IT: coloanele vin din Șablon; Default în Excel apare doar când câmpul e gol (sau 0 la valori numerice).',
    mobileBody:
      'Fluxul principal RAI: încarci aviz (PDF/poză), corectezi rândurile, bifezi și exporți Anexa Excel. Km, taxe și observații le completezi tu. IT: Default în Excel = doar când câmpul e gol.',
    path: '/avize',
    cta: 'Avize / Rapoarte',
    hint: 'În meniul din stânga: Avize / Rapoarte — fluxul principal pentru RAI.',
    mobileHint: 'Am deschis pagina Avize în spate. Poți închide ghidul și explora după tur.',
  },
  {
    id: 'dispatch',
    title: 'Curse — transporturile firmei',
    body:
      'Fiecare cursă e un transport (CMR): expeditor, destinatar, marfă, mașină și șofer. Flotă și Șoferi sunt tot în meniul de sus — acolo ții datele mașinilor și ale echipei. Șoferul vede cursele lui pe telefon (App Șofer), nu din acest meniu de birou. Documente te avertizează când se apropie expirarea ITP, RCA sau permisului.',
    mobileBody:
      'Curse = transporturile (CMR). Aici aloci mașina și șoferul. Flotă și Șoferi sunt tot în meniu. Șoferul folosește App Șofer pe telefon, separat de birou.',
    path: '/trips',
    cta: 'Curse',
    hint: 'Apasă Curse în meniu — de aici pornește dispeceratul zilnic.',
    mobileHint: 'Pagina Curse e deschisă. Pe telefon, listele apar ca carduri — ușor de parcurs cu degetul.',
  },
  {
    id: 'finance',
    title: 'Financiar — facturi în birou',
    body:
      'Aici ții facturile ca ciornă, cu număr ordonat (nu la întâmplare). Le poți trimite pe email și poți face ciornă direct din avize confirmate. Trimiterea automată la ANAF (e-Factura) nu e legată încă — nu e o eroare, pur și simplu nu e activă până la integrarea viitoare.',
    mobileBody:
      'Facturi ca ciornă, cu număr ordonat. Poți trimite pe email sau genera ciornă din avize. e-Factura ANAF nu e legată încă — e planificată separat.',
    path: '/finance',
    cta: 'Financiar',
    hint: 'Meniu → Financiar, când ești gata să facturezi după anexă.',
    mobileHint: 'Financiar funcționează și pe telefon — aceleași acțiuni, layout pe carduri.',
  },
  {
    id: 'demos',
    title: 'Pagini demo — nu sunt live',
    body:
      'Tracking GPS arată poziții simulate, nu GPS real de pe camion. Planning AI dă sugestii de probă, nu rutare reală. Le recunoști după eticheta „demo” în meniu. Restul — Avize, curse, flotă, clienți — sunt de lucru zi de zi.',
    mobileBody:
      'GPS și Planning AI sunt demo (simulare). Caută eticheta „demo” în meniu. Avize, curse și flotă sunt reale, de birou.',
    path: '/gps',
    cta: 'Tracking GPS',
    demo: true,
    hint: 'Exemplu: Tracking GPS (badge demo în meniu). Nu conta pe el pentru poziții reale.',
    mobileHint: 'Exemplu demo: Tracking GPS. Nu e GPS live de pe camion.',
  },
  {
    id: 'again',
    title: 'Ghidul rămâne la un click',
    body:
      'Gata pentru acum. Dacă uiți un pas, apasă Ghid jos în meniu — îl reparcurgi oricând. La următorul sync cu RAI actualizăm ghidul dacă apare ceva nou.',
    mobileBody:
      'Gata! Deschide meniul ☰ → jos găsești Ghid, lângă Setări. Îl poți relua oricând.',
    highlightTarget: 'ghid',
    cta: 'Ghid',
    hint: 'Butonul Ghid e jos în meniu, lângă Setări.',
    mobileHint: 'Ține minte: Meniu ☰ → Ghid (jos, lângă Setări).',
  },
];

export function hasSeenOfficeTour() {
  try {
    return localStorage.getItem(OFFICE_TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markOfficeTourSeen() {
  try {
    localStorage.setItem(OFFICE_TOUR_SEEN_KEY, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function clampTourStep(index, total = OFFICE_TOUR_STEPS.length) {
  const n = Number(index);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(total - 1, Math.trunc(n)));
}

/** Nav ring only when the step points at a menu route, not content/ghid spotlight. */
export function tourNavHighlightPath(step) {
  if (!step?.path || step.highlightTarget) return null;
  return step.path;
}

export function tourContentHighlightTarget(step) {
  return step?.highlightTarget === 'dashboard' ? 'dashboard' : null;
}

/** Mobile: menu cue + hamburger ring for nav routes and Ghid step. */
export function tourMobileMenuStep(step) {
  if (!step) return false;
  if (step.highlightTarget === 'ghid') return true;
  return Boolean(step.path && !step.highlightTarget);
}

export function tourMobileHighlightMenuButton(step) {
  return tourMobileMenuStep(step);
}

export function tourStepMobileBody(step) {
  return step?.mobileBody || step?.body || '';
}

export function tourStepMobileHint(step) {
  return step?.mobileHint || step?.hint || '';
}
