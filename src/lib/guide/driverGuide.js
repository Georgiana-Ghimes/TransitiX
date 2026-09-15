/**
 * The driver guide.
 *
 * A different document from the office one, not a shortened copy of it. The reader is in a cab,
 * on a phone, possibly with one hand and no signal, and needs to know three things: what to
 * photograph, whether it arrived, and what to do when it did not. Everything else is noise at
 * that moment.
 *
 * So: short sentences, no office vocabulary, and every status the screen can show explained in
 * the words the screen uses. A driver who cannot tell "Se procesează" from "Eșuat" will either
 * send the same aviz five times or assume the first one worked.
 */
import { note, p, steps, terms, warn } from './schema.js';

export const DRIVER_GUIDE = {
  id: 'driver',
  audience: 'Șofer',
  title: 'Ghidul șoferului',
  intro: 'Ai un singur lucru de făcut: trimite hârtiile de pe drum. Mai jos scrie cum, și ce înseamnă fiecare mesaj de pe ecran.',
  sections: [
    {
      id: 'ce-faci',
      title: 'Ce ai de făcut',
      blocks: [
        steps([
          'Apeși Încarcă documente.',
          'Alegi tipul: Aviz / cântar, Poză CMR sau Alt document.',
          'Apeși pe aparatul foto și fotografiezi hârtia, sau alegi o poză din galerie.',
          'Aștepți până apare în listă, sub buton.',
        ]),
        p('Gata. Biroul primește documentul imediat și îl citește programul. Nu trebuie să suni ca să anunți.'),
      ],
    },
    {
      id: 'poza-buna',
      title: 'Cum iese o poză bună',
      blocks: [
        terms([
          { term: 'Toată hârtia în cadru', text: 'Colțurile să se vadă. Dacă lipsește o margine, poate lipsi tocmai numărul.' },
          { term: 'Drept de deasupra', text: 'Nu din lateral. Textul înclinat se citește prost.' },
          { term: 'Lumină', text: 'Pe bord ziua e bine. Noaptea, aprinde plafoniera și ține telefonul nemișcat.' },
          { term: 'Fără umbra ta', text: 'Dă-te puțin într-o parte, umbra peste jumătate de pagină ascunde rândurile.' },
        ]),
        note('Dacă poza iese mișcată, aplicația îți spune înainte să o trimită. Refă-o atunci, e mai simplu decât peste două zile, când hârtia nu mai e la tine.'),
      ],
    },
    {
      id: 'ce-trimiti',
      title: 'Ce documente trimiți',
      blocks: [
        terms([
          { term: 'Aviz / cântar', text: 'Cel mai important. De aici se scot numărul comenzii, data, mașina, adresa și greutatea.' },
          { term: 'Poză CMR', text: 'Scrisoarea de transport, când o ai.' },
          { term: 'Alt document', text: 'Orice altceva îți cere biroul: bon, proces verbal, confirmare de primire.' },
        ]),
        p('Trimite fiecare hârtie separat, nu toate într-o poză. Programul face un rând pentru fiecare fotografie.'),
      ],
    },
    {
      id: 'statusuri',
      title: 'Ce înseamnă mesajul de lângă document',
      blocks: [
        terms([
          { term: 'Se procesează', text: 'A ajuns la birou, programul îl citește acum. Nu mai trimite încă o dată.' },
          { term: 'OCR gata', text: 'A fost citit. Dacă apare și un număr lângă, acela e numărul comenzii de pe hârtie.' },
          { term: 'OCR gata, fără TPO', text: 'S-a citit, dar nu s-a găsit numărul comenzii. Nu e treaba ta, biroul îl completează.' },
          { term: 'De revizuit', text: 'Biroul trebuie să verifice ceva. Iar nu e treaba ta.' },
          { term: 'Confirmat', text: 'Biroul l-a verificat. Documentul e închis.' },
          { term: 'Nerecunoscut', text: 'Programul nu a putut citi hârtia. Merită o poză nouă, mai clară, dacă mai ai documentul.' },
          { term: 'Eșuat', text: 'Trimiterea nu a reușit. Încearcă din nou.' },
          { term: 'Netrimis, așteaptă semnal', text: 'Nu ai avut internet. Documentul e salvat în telefon și pleacă singur când prinzi semnal.' },
        ]),
      ],
    },
    {
      id: 'fara-semnal',
      title: 'Când nu ai semnal',
      blocks: [
        p('Poți fotografia și fără internet. Documentul rămâne în telefon și se trimite singur când revine semnalul. Nu se pierde.'),
        warn('Nu șterge aplicația din telefon și nu goli datele cât timp scrie „Netrimis”. Acolo stau documentele care nu au plecat încă.'),
        p('Dacă vezi „Procesare întreruptă, reluăm la reconectare”, documentul a ajuns deja la birou. Se termină de citit singur.'),
      ],
    },
    {
      id: 'limite',
      title: 'Limite',
      blocks: [
        terms([
          { term: 'Cel mult 8 fișiere odată', text: 'Dacă ai mai multe, trimite-le în două reprize.' },
          { term: 'Cel mult 15 MB un fișier', text: 'Pozele de telefon intră fără probleme. Dacă îți spune că e prea mare, fă poza din nou în loc să o scanezi la rezoluție maximă.' },
        ]),
      ],
    },
    {
      id: 'profil',
      title: 'Profil',
      blocks: [
        p('Aici îți vezi datele: nume, telefon, categoriile de permis și termenele documentelor tale.'),
        p('Dacă vezi ceva greșit, spune la birou. Din telefon nu se modifică, tocmai ca să nu se schimbe din greșeală datele după care se fac programările.'),
      ],
    },
    {
      id: 'nu-face',
      title: 'Ce nu trebuie să faci',
      blocks: [
        terms([
          { term: 'Nu trimite de două ori același aviz', text: 'Biroul îl vede o dată. Trimis de două ori, apare ca dublură și cineva pierde timp verificând.' },
          { term: 'Nu completa cifre', text: 'Km, tarife și taxe le pune biroul. Tu trimiți hârtia așa cum e.' },
          { term: 'Nu aștepta sfârșitul cursei', text: 'Trimite avizul când îl primești. Hârtia se pierde, poza nu.' },
        ]),
      ],
    },
  ],
};
