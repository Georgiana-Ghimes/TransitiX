/**
 * Writes qa/testiny/transitix-test-cases.csv for the Testiny importer.
 * Step mode: rows (same folder + title = one test case, one step per row).
 * Folder separator: " > "
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cases = [];

function tc(folder, title, description, precondition, priority, steps) {
  cases.push({ folder, title, description, precondition, priority, steps });
}

const OFFICE = 'Profil TransitiX (birou complet), autentificat ca admin@transitix.ro / admin123 pe http://127.0.0.1:5173/.';
const COMPANION = 'Profil companion documente (VITE_APP_PROFILE=documents), autentificat ca admin pe http://127.0.0.1:5173/.';
const LOGGED_OUT = 'Browser fără sesiune, pe http://127.0.0.1:5173/.';

tc('Autentificare', 'Login birou cu contul seed',
  'Administratorul intră în aplicație cu contul din seed.',
  LOGGED_OUT,
  'High', [
    ['Introdu admin@transitix.ro și admin123 și autentifică-te.', 'Sesiunea se deschide. În profilul complet ajungi pe Dashboard; în companion ajungi pe Avize OCR.'],
  ]);

tc('Autentificare', 'Parolă greșită nu deschide aplicația',
  'Un login eșuat rămâne pe ecranul de autentificare.',
  LOGGED_OUT,
  'High', [
    ['Introdu admin@transitix.ro și o parolă greșită, apoi trimite formularul.', 'Rămâi pe login. Nu se încarcă dashboard-ul sau avizele și nu rămâne o sesiune validă.'],
  ]);

tc('Autentificare', 'După login revii pe pagina cerută',
  'returnTo te aduce înapoi la ruta la care ai încercat să intri.',
  LOGGED_OUT,
  'Medium', [
    ['Deschide direct o rută protejată, de exemplu /avize sau /trips.', 'Ești trimis la /login cu returnTo către ruta cerută.'],
    ['Autentifică-te cu admin@transitix.ro / admin123.', 'Aterizezi pe ruta din returnTo, nu pe o pagină oarecare.'],
  ]);

tc('Autentificare', 'Resetarea parolei fără Resend dă link local',
  'Fără cheie de email, resetarea tot produce un link utilizabil local.',
  'RESEND_API_KEY este gol. Contul admin@transitix.ro există.',
  'Medium', [
    ['Pe Am uitat parola introdu admin@transitix.ro.', 'Aplicația nu pretinde că a trimis un email real. Linkul de reset apare local (consolă sau răspunsul de development).'],
    ['Deschide linkul și setează o parolă nouă, apoi intră cu ea.', 'Parola nouă autentifică. Parola veche nu mai intră.'],
  ]);

tc('Autentificare', 'Înregistrarea respectă dacă sign-up-ul e deschis',
  'Pagina de înregistrare întreabă serverul, nu presupune că oricine poate crea cont.',
  LOGGED_OUT,
  'Medium', [
    ['Deschide /register.', 'Dacă sign-up-ul e închis, formularul nu creează un cont. Dacă e deschis, un cont nou cere confirmarea pe care o cere serverul (/verify-email).'],
  ]);

tc('Autentificare', 'Delogarea închide sesiunea',
  'După logout, rutele protejate cer din nou login.',
  OFFICE,
  'High', [
    ['Deloghează-te, apoi deschide /trips sau /avize.', 'Ești trimis la login. Datele companiei nu mai sunt vizibile.'],
  ]);

tc('Companion > Navigare', 'Companionul pornește pe Avize',
  'Profilul de documente nu deschide dashboard-ul de TMS.',
  COMPANION,
  'High', [
    ['Autentifică-te și uită-te la ruta și la meniu.', 'Ruta este /avize. Meniul are Avize OCR, Rapoarte, Harta zonelor și Flotă (Autoturisme, ITP). Nu apar Curse, Dispecerat sau Financiar.'],
  ]);

tc('Companion > Navigare', 'O rută de TMS din companion revine la Avize',
  'Companionul nu lasă deschise ecranele de birou complet.',
  COMPANION,
  'Medium', [
    ['Deschide manual /trips, /dispatch sau /finance.', 'Ești readus la /avize. Ecranul de curse nu rămâne pe ecran.'],
  ]);

tc('Companion > Navigare', 'ITP nu aprinde și Autoturisme în meniu',
  'Cele două intrări din Flotă sunt rute diferite.',
  COMPANION,
  'Low', [
    ['Deschide /fleet/itp.', 'În meniu este activ ITP, nu și Autoturisme.'],
    ['Deschide /fleet.', 'Este activ Autoturisme. ITP nu rămâne marcat.'],
  ]);

tc('Companion > Navigare', 'Sidebar-ul rămâne vizibil cât se încarcă o pagină',
  'Încărcarea unui ecran nu golește meniul.',
  COMPANION,
  'Medium', [
    ['Treci între Avize, Rapoarte, Harta zonelor și ITP.', 'Meniul lateral rămâne pe ecran în timp ce pagina se încarcă. Nu apare un ecran alb fără navigare.'],
  ]);

tc('Companion > Avize > Încărcare', 'PDF cu strat de text se citește fără Mistral',
  'Un PDF care are text selectabil nu depinde de cheia OCR.',
  `${COMPANION} MISTRAL_API_KEY poate lipsi. Ai un PDF de aviz cu text selectabil.`,
  'High', [
    ['Încarcă PDF-ul pe Avize OCR.', 'Upload-ul reușește. Câmpurile citite din text (număr, date, cantități) apar în tabel, nu un rând gol.'],
  ]);

tc('Companion > Avize > Încărcare', 'Fără OCR upload-ul tot reușește',
  'Lipsa cheii Mistral nu blochează coada.',
  `${COMPANION} MISTRAL_API_KEY lipsește. Ai o poză de aviz, nu un PDF cu text.`,
  'High', [
    ['Încarcă poza.', 'Documentul intră în listă. Câmpurile rămân de completat de mână. Nu apare o eroare care să piardă fișierul.'],
  ]);

tc('Companion > Avize > Încărcare', 'OCR căzut se vede și blochează reextragerea',
  'Când Mistral e configurat dar nu răspunde, ecranul o spune.',
  `${COMPANION} Cheia Mistral e setată, dar serviciul nu răspunde (health ocr = mistral-down).`,
  'High', [
    ['Deschide Avize OCR.', 'Apare bannerul că OCR-ul e indisponibil.'],
    ['Pe un rând apasă Reextrage.', 'Butonul este dezactivat cât OCR-ul e jos. Documentul existent nu este șters.'],
  ]);

tc('Companion > Avize > Încărcare', 'Fișierul încărcat nu se deschide fără login',
  'Pozele și PDF-urile din /uploads cer token.',
  `${COMPANION} Există un aviz încărcat. Copiezi URL-ul fișierului.`,
  'High', [
    ['Deschide URL-ul într-o fereastră privată, fără sesiune.', 'Fișierul nu se descarcă. Cererea este refuzată până la autentificare.'],
  ]);

tc('Companion > Avize > Încărcare', 'Câmpurile cu încredere mică sunt marcate',
  'Valorile nesigure se văd înainte de confirmare.',
  `${COMPANION} Există un aviz la care numărul TPO, ruta sau numărul auto au încredere mică.`,
  'Medium', [
    ['Uită-te la rândul din tabel.', 'Câmpurile slabe sunt amber, nu arată ca o valoare sigură. Ruta învățată dintr-o regulă este marcată distinct de una citită de pe document.'],
  ]);

tc('Companion > Avize > Verificare', 'Verificarea se deschide pentru un aviz nesigur',
  'HITL este calea normală când OCR-ul nu e sigur.',
  `${COMPANION} Un aviz are needs_review sau routing hitl_required.`,
  'High', [
    ['Apasă Verifică pe rând.', 'Se deschide panoul de verificare, cu câmpurile și constatările, nu se confirmă documentul direct.'],
  ]);

tc('Companion > Avize > Verificare', 'Un aviz curat se confirmă',
  'Confirmarea fără forțare este permisă doar când nu mai e nimic de verificat.',
  `${COMPANION} Un aviz nu are needs_review și nu e marcat hitl_required.`,
  'High', [
    ['Apasă Confirmă.', 'Statusul devine confirmat. Rândul nu mai cere verificare.'],
  ]);

tc('Companion > Avize > Verificare', 'Avizul de verificat nu se confirmă dintr-un clic',
  'Confirmarea este blocată cât există câmpuri de verificat.',
  `${COMPANION} Avizul are needs_review sau routing hitl_required. Ești admin sau dispecer, fără force.`,
  'High', [
    ['Apasă Confirmă, fără să deschizi verificarea și fără motiv de forțare.', 'Confirmarea este refuzată. Mesajul spune că documentul are câmpuri de verificat. Statusul rămâne neconfirmat.'],
  ]);

tc('Companion > Avize > Verificare', 'Doar adminul poate forța confirmarea, cu motiv',
  'Forțarea lasă o urmă și nu e disponibilă oricui.',
  `${COMPANION} Avizul cere verificare.`,
  'High', [
    ['Ca utilizator care nu e admin, încearcă confirmarea forțată.', 'Serverul răspunde că doar un administrator poate forța. Avizul rămâne neconfirmat.'],
    ['Ca admin, forțează fără motiv.', 'Cererea este refuzată: motivul scurt este obligatoriu.'],
    ['Ca admin, forțează cu un motiv scurt.', 'Avizul devine confirmat. Jurnalul reține că a fost forțat și motivul.'],
  ]);

tc('Companion > Avize > Verificare', 'Confirmarea în masă sare peste avizele de verificat',
  'Selecția mixtă nu confirmă și documentele nesigure.',
  `${COMPANION} Sunt bifate un aviz curat și unul cu needs_review. Nu trimiți force.`,
  'High', [
    ['Apasă confirmarea pentru selecție.', 'Operația este oprită cu lista documentelor care încă cer verificare. Avizul nesigur nu trece în confirmat.'],
  ]);

tc('Companion > Avize > Verificare', 'Confirmarea în masă cere cel puțin un aviz',
  'Un clic fără selecție nu confirmă toată coada.',
  COMPANION,
  'Medium', [
    ['Fără niciun rând bifat, încearcă confirmarea în masă.', 'Primești că trebuie selectat cel puțin un aviz. Nimic nu își schimbă statusul.'],
  ]);

tc('Companion > Avize > Verificare', 'Același număr TPO este semnalat',
  'Duplicatele de TPO nu se ascund în tabel.',
  `${COMPANION} Două avize au același numar_tpo.`,
  'Medium', [
    ['Uită-te la ambele rânduri după încărcare sau confirmare.', 'Duplicatul este marcat pe ambele, nu doar pe al doilea.'],
  ]);

tc('Companion > Avize > Editare', 'Editarea corectează câmpurile și rămâne salvată',
  'Corecția umană înlocuiește valoarea citită.',
  `${COMPANION} Există un aviz neconfirmat, cu un număr auto greșit.`,
  'High', [
    ['Apasă Editează, corectează numărul auto și salvează.', 'Tabelul arată valoarea nouă după reîncărcarea paginii.'],
    ['Cât salvarea e în curs, butoanele rândului sunt blocate.', 'Nu poți șterge sau confirma același rând în paralel cu salvarea.'],
  ]);

tc('Companion > Avize > Editare', 'Ștergerea unui aviz cere confirmare',
  'Un rând nu dispare la primul clic.',
  COMPANION,
  'High', [
    ['Apasă Șterge pe un rând, apoi anulează.', 'Avizul rămâne în listă și fișierul lui rămâne.'],
    ['Apasă Șterge și confirmă.', 'Rândul dispare din listă și nu mai intră la export.'],
  ]);

tc('Companion > Avize > Editare', 'Ștergerea în masă acoperă doar rândurile bifate',
  'Selecția nu șterge pagina întreagă dacă nu e bifată.',
  `${COMPANION} Sunt bifate două avize. Pe pagină mai sunt și altele nebifate.`,
  'High', [
    ['Cu zero bifate, butonul de ștergere în masă explică faptul că trebuie bifate rânduri.', 'Nu se șterge nimic.'],
    ['Bifează două rânduri și confirmă ștergerea.', 'Dispar doar cele două. Restul rămân.'],
  ]);

tc('Companion > Avize > Editare', 'Paginarea nu amestecă selecția cu altă pagină',
  'Numărul de rânduri pe pagină schimbă doar fereastra vizibilă.',
  `${COMPANION} Există mai multe avize decât încap pe o pagină.`,
  'Low', [
    ['Schimbă numărul de avize pe pagină și treci la pagina următoare.', 'Vezi următorul set. Bifa de „pagina curentă” selectează doar rândurile vizibile, nu toată baza.'],
  ]);

tc('Companion > Avize > Export', 'Exportul de anexă folosește șablonul de coloane',
  'Anexa de factură iese cu coloanele din șablon, nu cu un set fix ascuns.',
  `${COMPANION} Există avize confirmate și un șablon de anexă.`,
  'High', [
    ['Deschide șablonul, schimbă ordinea unei coloane și salvează.', 'Șablonul reține ordinea.'],
    ['Exportă anexa.', 'Fișierul conține avizele alese și coloanele din șablon, în ordinea salvată.'],
  ]);

tc('Companion > Avize > Export', 'Ciorna de factură pleacă din avize confirmate',
  'Un aviz neconfirmat nu intră singur într-o factură.',
  `${COMPANION} Ai avize confirmate și cel puțin unul neconfirmat.`,
  'High', [
    ['Generează ciorna de factură din avizele confirmate.', 'Ciorna conține doar confirmatele. Avizul neconfirmat nu adaugă o linie.'],
  ]);

tc('Companion > Avize > Export', 'Emailul și arhiva zip pleacă doar pentru selecție',
  'Trimiterea nu atașează toată coada dacă ai ales câteva.',
  `${COMPANION} Sunt bifate unele avize. Emailul e configurat sau, fără cheie, trimiterea e raportată cinstit.`,
  'Medium', [
    ['Trimite email sau descarcă zip pentru selecție.', 'Pleacă doar documentele bifate. Fără Resend, aplicația nu pretinde că mailul a ajuns la client.'],
  ]);

tc('Companion > Avize > Export', 'Codul de observație se adaugă și se șterge',
  'Lista de coduri folosită la avize este a companiei.',
  COMPANION,
  'Low', [
    ['Adaugă un cod de observație, folosește-l pe un aviz, apoi șterge codul din listă.', 'Codul nou poate fi ales. După ștergere nu mai apare la avizele următoare. Avizul deja salvat își păstrează textul scris.'],
  ]);

tc('Companion > Rapoarte', 'Exportul Excel se descarcă și intră în istoric',
  'Raportul curent produce un fișier și o linie de istoric.',
  `${COMPANION} Există date de raport pentru perioada aleasă.`,
  'High', [
    ['Alege perioada și apasă Exportă Excel.', 'Se descarcă un fișier Excel. În istoric apare o linie nouă, cu numele șablonului.'],
  ]);

tc('Companion > Rapoarte', 'Un export din istoric se poate redescărca',
  'Istoricul ține fișierul, nu doar numele.',
  `${COMPANION} Există un export recent în istoric.`,
  'Medium', [
    ['Apasă redescarcă pe linia din istoric.', 'Primești același fișier, fără să regenerezi raportul.'],
  ]);

tc('Companion > Rapoarte', 'Ștergerea din istoric oprește redescărcarea',
  'Ștergerea scoate exportul, nu și avizele.',
  `${COMPANION} Există un export în istoric.`,
  'Medium', [
    ['Șterge linia și confirmă.', 'Mesajul spune că redescărcarea nu mai e posibilă. Linia dispare. Avizele din coadă rămân.'],
  ]);

tc('Companion > Rapoarte', 'Exportul mai vechi decât conținutul este marcat',
  'Un fișier din istoric nu se pretinde proaspăt dacă datele s-au schimbat după el.',
  `${COMPANION} Există un export, apoi s-a confirmat sau editat un aviz care intră în acel raport.`,
  'Medium', [
    ['Uită-te la linia veche din istoric.', 'Este marcată ca export mai vechi decât salvarea conținutului. Nu arată ca ultimul adevăr.'],
  ]);

tc('Companion > Harta zonelor', 'Zonele București se văd fără configurare',
  'Contururile de referință vin cu aplicația.',
  COMPANION,
  'High', [
    ['Deschide Harta zonelor.', 'Vezi orașul și contururile A și B fără să imporți nimic. Ecranul spune că verificarea adresei folosește aceeași potrivire ca TPO.'],
  ]);

tc('Companion > Harta zonelor', 'Legarea zonei de un tarif este o acțiune separată',
  'Conturul nu pune bani pe factură doar pentru că e desenat.',
  COMPANION,
  'High', [
    ['Uită-te la o zonă de referință care nu are încă tarif.', 'Cardul arată conturul, fără sumă.'],
    ['Leagă explicit zona de un tarif și salvează.', 'Cardul arată suma. Fără acest pas, zona nu contribuie la taxă.'],
  ]);

tc('Companion > Harta zonelor', 'Căutarea unei adrese dă același răspuns ca TPO',
  'Verificarea de pe hartă nu are o logică paralelă.',
  `${COMPANION} Ai o adresă din București pe care o folosești și pe un aviz.`,
  'High', [
    ['Caută adresa pe hartă.', 'Pinul se mută pe adresă. Zona anunțată este aceeași cu cea folosită la calculul TPO pentru acea adresă. Harta nu sare înapoi pe tot orașul cât timp pinul e rezultatul căutării.'],
  ]);

tc('Companion > Harta zonelor', 'Un contur importat invalid este respins',
  'Nu se salvează un poligon care nu poate fi o zonă.',
  COMPANION,
  'Medium', [
    ['Importă un fișier care nu este un contur plauzibil.', 'Importul eșuează cu eroare. Zonele existente rămân neschimbate.'],
  ]);

tc('Companion > Flotă > Autoturisme', 'O mașină nouă se adaugă după număr',
  'Numărul văzut pe aviz se înregistrează o dată.',
  COMPANION,
  'High', [
    ['Apasă Adaugă mașină, scrie un număr nou și salvează.', 'Mașina apare în listă. Același număr nu creează o a doua înregistrare dacă îl trimiți din nou.'],
  ]);

tc('Companion > Flotă > Autoturisme', 'MTMA lipsă blochează taxa de zonă și se anunță',
  'Fără masa din talon nu se inventează o taxă.',
  `${COMPANION} Cel puțin o mașină activă nu are MTMA.`,
  'High', [
    ['Deschide Autoturisme.', 'Bannerul spune câte mașini nu au MTMA și că fără ea nu se calculează taxa de zonă pentru cursele lor.'],
    ['Completează MTMA și salvează.', 'Bannerul scade cu mașina respectivă. La un aviz cu acea mașină, taxa poate fi calculată.'],
  ]);

tc('Companion > Flotă > Autoturisme', 'Ștergerea unei mașini o scoate din listă',
  'Numărul șters nu mai e folosit la mașini noi.',
  `${COMPANION} Există o mașină de test pe care o poți șterge.`,
  'Medium', [
    ['Șterge mașina și confirmă.', 'Dispare din listă. Un aviz nou nu o mai găsește ca vehicul cunoscut.'],
  ]);

tc('Companion > Flotă > ITP', 'Cardurile filtrează expirate, curând, fără dată și ok',
  'Orizontul de „expiră curând” este cel din setări.',
  `${COMPANION} Flota activă are mașini în toate cele patru stări, sau măcar două.`,
  'High', [
    ['Deschide ITP.', 'Cele patru carduri arată numerele: Expirate, Expiră curând, Fără dată, OK. Textul spune orizontul în zile și că implicit transportul de marfă propune expirare + 1 an.'],
    ['Apasă un card, apoi același card din nou.', 'Lista se filtrează pe starea aleasă. Al doilea clic revine la toate.'],
    ['Caută după o plăcuță.', 'Rămân doar mașinile al căror număr se potrivește, în filtrul curent.'],
  ]);

tc('Companion > Flotă > ITP', 'Derularea ITP propune următoarea dată, nu o inventează peste talon',
  'Data din talon rămâne sursa. Aplicația doar propune periodicitatea.',
  `${COMPANION} O mașină de marfă are dată de expirare ITP.`,
  'High', [
    ['Deschide mașina și derulează ITP.', 'Următoarea dată propusă este expirarea plus un an. Poți alege altă categorie (autoturism, remorcă, taxi) înainte să salvezi, iar periodicitatea se schimbă odată cu categoria.'],
    ['Salvează.', 'Lista și cardul de stare reflectă noua expirare.'],
  ]);

tc('Companion > App șofer', 'Șoferul din companion vede documente, nu curse',
  'Shell-ul companion nu este aplicația de executat curse.',
  'Profil companion. Cont sofer@transitix.ro / sofer123, legat de un șofer.',
  'High', [
    ['Autentifică-te ca șofer.', 'Aterizezi în shell-ul de documente: încărcare documente, profil și ghid. Nu vezi lista de curse sau butonul Am încărcat.'],
  ]);

tc('Companion > App șofer', 'Șoferul încarcă un document',
  'Documentul ajunge la coada companiei, legat de șofer.',
  'Profil companion, autentificat ca sofer@transitix.ro. Ai o poză de document.',
  'High', [
    ['Pe tabul Documente încarcă fișierul.', 'Upload-ul reușește. În birou, documentul este vizibil la companie, nu rămâne doar pe telefon.'],
  ]);

tc('Companion > Setări', 'Setările țin compania, alertele și sesiunile',
  'Pragul de alerte ITP folosit pe ecranul ITP se schimbă de aici.',
  COMPANION,
  'Medium', [
    ['Deschide Setări și schimbă pragul de alertă pentru documente, apoi salvează.', 'Valoarea rămâne după reîncărcare. Pe ITP, textul cu orizontul de zile folosește noul prag.'],
  ]);

tc('Companion > Setări', 'Utilizatorii sunt doar pentru admin',
  'Un dispecer nu administrează conturi.',
  `${COMPANION} Ai un cont de birou care nu este admin.`,
  'High', [
    ['Ca non-admin, deschide Setări.', 'Tabul Utilizatori nu este oferit.'],
    ['Deschide manual /users sau /settings?tab=users.', 'Nu poți crea sau modifica utilizatori.'],
    ['Ca admin, deschide /users.', 'Ești dus la Setări, tabul Utilizatori, și poți vedea conturile companiei.'],
  ]);

tc('TransitiX > Dashboard', 'Dashboard-ul arată indicatorii și cursele recente',
  'Intrarea în biroul complet nu este ecranul de avize.',
  OFFICE,
  'Medium', [
    ['Deschide /.', 'Vezi Dashboard, cu indicatori și curse recente. Meniul conține Dispecerat, Curse, Flotă, Financiar și restul biroului.'],
  ]);

tc('TransitiX > Curse', 'Lista de curse și filtrul Alocate',
  'Ecranul Curse este punctul de alocare.',
  OFFICE,
  'High', [
    ['Deschide Curse.', 'Vezi lista și butonul Cursă nouă. Filtrul Alocate arată doar cursele cu status Alocată.'],
  ]);

tc('TransitiX > Curse', 'Cursă nouă cu șofer devine Alocată',
  'Salvarea cu șofer mută statusul și notifică șoferul.',
  `${OFFICE} Există un șofer activ și un vehicul activ.`,
  'High', [
    ['Apasă Cursă nouă, alege șoferul și vehiculul, completează câmpurile obligatorii și salvează.', 'Cursa apare cu status Alocată. Șoferul ales o vede în App Șofer.'],
  ]);

tc('TransitiX > Curse', 'Fără șofer, cursa nu rămâne Alocată',
  'Statusul Alocată cere un șofer.',
  OFFICE,
  'High', [
    ['Creează sau editează o cursă cu status Alocată și fără șofer, apoi salvează.', 'Salvarea nu lasă o cursă alocată nimănui. Statusul coboară sau salvarea cere șoferul.'],
  ]);

tc('TransitiX > Curse', 'Distanța scrisă de dispecer rămâne manuală',
  'Rutarea nu rescrie un număr introdus de om.',
  `${OFFICE} Cursa are ambele capete rezolvate la coordonate.`,
  'High', [
    ['Scrie o distanță și salvează, apoi redeschide cursa.', 'Numărul rămâne cel scris. Sursa este manuală.'],
    ['Golește distanța și salvează.', 'Câmpul e predat înapoi. Dacă OSRM răspunde, distanța se completează; dacă nu, cursa se salvează fără distanță.'],
  ]);

tc('TransitiX > Curse', 'Salvarea CMR nu depinde de OSRM',
  'O cursă se salvează și când rutarea e căzută.',
  `${OFFICE} OSRM_URL lipsește sau serviciul nu răspunde.`,
  'High', [
    ['Salvează o cursă cu date complete.', 'Cursa se salvează. Distanța automată lipsește, fără eroare care să piardă CMR-ul.'],
  ]);

tc('TransitiX > Curse', 'Detaliul unei curse arată același status ca lista',
  'Pagina /trips/:id nu are o stare diferită de listă.',
  `${OFFICE} Există o cursă salvată.`,
  'Medium', [
    ['Deschide cursa din listă.', 'Numărul, șoferul, vehiculul și statusul coincid cu rândul din listă.'],
  ]);

tc('TransitiX > Dispecerat', 'Board-ul se folosește fără drag-and-drop',
  'Alocarea, reordonarea și detașarea au butoane.',
  OFFICE,
  'High', [
    ['Deschide Dispecerat.', 'Vezi comenzile zilei și rutele.'],
    ['Alocă o comandă din listă, mut-o cu săgețile și detașeaz-o.', 'Fiecare acțiune schimbă ruta fără să fie nevoie de mouse-drag. Pe un ecran îngust, aceleași acțiuni rămân disponibile.'],
  ]);

tc('TransitiX > Dispecerat', 'Fără OSRM, distanțele și ETA rămân goale',
  'Ruta se construiește și când motorul de rutare lipsește.',
  `${OFFICE} OSRM nu este configurat sau /api/geo/health nu e ok.`,
  'High', [
    ['Construiește și ordonează o rută.', 'Ruta se salvează. Distanțele, ETA și traseul de pe hartă rămân goale, iar board-ul o spune. Nu se inventează kilometri.'],
  ]);

tc('TransitiX > Dispecerat', 'Cu OSRM, distanța și traseul se completează',
  'Aceeași rută primește kilometri când motorul răspunde.',
  `${OFFICE} OSRM_URL răspunde și capetele comenzilor au coordonate.`,
  'Medium', [
    ['Construiește o rută cu cel puțin două opriri geocodate.', 'Apar distanța, ETA și traseul. Valorile vin din OSRM, nu dintr-un număr fix.'],
  ]);

tc('TransitiX > Încărcare', 'Planul de încărcare se deschide pentru o cursă',
  'Ecranul de încărcare nu cere date din afara cursei.',
  OFFICE,
  'Medium', [
    ['Deschide Încărcare și alege o cursă care are marfă.', 'Vezi planul de încărcare al cursei. O cursă fără marfă nu afișează un plan inventat.'],
  ]);

tc('TransitiX > Plan 2D', 'Planul 2D se deschide separat de încărcarea simplă',
  'Cele două ecrane nu se înlocuiesc unul pe altul.',
  OFFICE,
  'Low', [
    ['Deschide Plan 2D, apoi Încărcare.', 'Fiecare rută își păstrează ecranul. Meniul marchează pagina pe care ești.'],
  ]);

tc('TransitiX > Flotă și șoferi', 'Dezactivarea scoate vehiculul din alocare',
  'Un vehicul inactiv nu mai poate fi pus pe o cursă nouă.',
  `${OFFICE} Există un vehicul care nu e pe o cursă activă.`,
  'High', [
    ['Pe Flotă dezactivează vehiculul.', 'Nu mai apare la vehiculele active din Cursă nouă sau Dispecerat.'],
    ['Reactivează-l.', 'Revine în listele de alocare.'],
  ]);

tc('TransitiX > Flotă și șoferi', 'Șoferul dezactivat nu primește curse noi',
  'Aceeași regulă ca la vehicul.',
  OFFICE,
  'High', [
    ['Dezactivează un șofer care nu e pe o cursă activă.', 'Nu mai poate fi ales la o cursă nouă.'],
    ['Reactivează-l.', 'Reapare în listă și poate fi alocat.'],
  ]);

tc('TransitiX > Flotă și șoferi', 'Autoturismele de pe avize sunt separate de flota de camioane',
  'Numerele de pe avize nu se amestecă în flota de curse.',
  OFFICE,
  'Medium', [
    ['Deschide Autoturisme și adaugă un număr văzut pe un aviz, cu MTMA.', 'Numărul este în lista de autoturisme. Nu apare ca vehicul de cursă în Dispecerat dacă nu a fost creat și acolo.'],
  ]);

tc('TransitiX > Locații', 'Pinul neverificat se confirmă doar de om',
  'Geocoderul nu marchează singur locația ca verificată.',
  `${OFFICE} Există o locație salvată dar neverificată.`,
  'High', [
    ['Deschide Locații. Dacă pinul e deplasat, mută-l, apoi confirmă.', 'Locația iese din coada de neverificate. geocode_verified se setează la confirmare, nu la salvarea automată.'],
  ]);

tc('TransitiX > Locații', 'O adresă sub pragul minim nu primește pin',
  'Mai bine fără pin decât cu un pin greșit.',
  `${OFFICE} Geocoderul e pornit. Ai o adresă pe care potrivirea cade sub 0.45.`,
  'Medium', [
    ['Rulează geocodarea sau salvează adresa.', 'Nu se scrie niciun pin. Locația rămâne fără coordonate, vizibilă ca neverificată sau lipsă, nu cu un punct inventat.'],
  ]);

tc('TransitiX > Teritorii', 'Un teritoriu se salvează și se vede pe listă',
  'Teritoriile sunt configurarea companiei, nu a hărții de referință.',
  OFFICE,
  'Low', [
    ['Creează un teritoriu cu un nume nou și salvează.', 'Apare în listă după reîncărcare. Un nume gol nu se salvează.'],
  ]);

tc('TransitiX > GPS', 'Harta GPS este demo, nu telematică live',
  'Ecranul nu trebuie citit ca poziție reală a camionului.',
  OFFICE,
  'High', [
    ['Deschide Tracking GPS.', 'Harta se încarcă și este etichetată ca demo. Nu apare o poziție prezentată ca live de la un dispozitiv.'],
  ]);

tc('TransitiX > Planning AI', 'Sugestiile de planning sunt marcate ca demo',
  'Ecranul nu execută un optimizator real neanunțat.',
  OFFICE,
  'Medium', [
    ['Deschide Planning AI.', 'Sugestiile, dacă apar, sunt etichetate ca demo. Nu se creează curse singure, fără o acțiune explicită de salvare.'],
  ]);

tc('TransitiX > Clienți', 'Clientul dezactivat nu mai e oferit la curse noi',
  'Istoricul lui rămâne.',
  OFFICE,
  'Medium', [
    ['Dezactivează un client, apoi deschide Cursă nouă.', 'Clientul nu mai e în lista de clienți activi. Cursele lui vechi rămân vizibile.'],
    ['Reactivează-l.', 'Revine la alegere.'],
  ]);

tc('TransitiX > Depozit', 'Un produs de stoc se adaugă și se vede în depozit',
  'Depozitul ține produse, nu curse.',
  OFFICE,
  'Low', [
    ['Adaugă un produs cu cantitate și salvează.', 'Apare în listă. Cantitatea nu devine negativă dacă încerci o ieșire mai mare decât stocul.'],
  ]);

tc('TransitiX > Documente', 'Documentul aproape de expirare apare la alerte',
  'Pragul din Setări decide ce intră în alertă.',
  `${OFFICE} Există un ITP, RCA sau permis cu expirarea în interiorul pragului.`,
  'High', [
    ['Deschide Documente.', 'Documentul este la alerte, cu tipul și data. Un document mult în afara pragului nu este amestecat în aceeași alertă.'],
  ]);

tc('TransitiX > Financiar', 'e-Factura rămâne locală, fără acceptat ANAF',
  'SPV nu este conectat. Ecranul nu inventează un accept.',
  OFFICE,
  'High', [
    ['Deschide Financiar.', 'Bannerul spune că e-Factura SPV nu e conectată și că statusul rămâne local.'],
    ['Acționează trimiterea către SPV pe o factură.', 'Nu apare un status acceptat de ANAF. Factura rămâne ciornă locală sau not_sent.'],
  ]);

tc('TransitiX > Financiar', 'Factura trimisă pe email nu pretinde livrare fără Resend',
  'Fără cheie, mailul nu este raportat ca trimis.',
  `${OFFICE} RESEND_API_KEY este gol. Există o factură.`,
  'Medium', [
    ['Încearcă trimiterea facturii pe email.', 'Aplicația nu arată factura ca trimisă către client. Fără cheie, trimiterea rămâne locală sau eșuează vizibil.'],
  ]);

tc('TransitiX > Configurare comercială', 'O setare comercială salvată rămâne după reîncărcare',
  'Tarifele și regulile nu se resetează la refresh.',
  OFFICE,
  'Medium', [
    ['Schimbă o valoare comercială vizibilă și salvează, apoi reîncarcă pagina.', 'Valoarea salvată este cea afișată. Un câmp obligatoriu gol nu se salvează.'],
  ]);

tc('TransitiX > Utilizatori și audit', 'Jurnalul și utilizatorii sunt doar pentru admin',
  'Un dispecer nu citește jurnalul de activitate al firmei.',
  `${OFFICE} Ai și un cont care nu este admin.`,
  'High', [
    ['Ca non-admin, uită-te la meniu și deschide /audit și /users.', 'Intrările lipsesc din meniu. Rutele nu arată jurnalul și nu lasă modificarea conturilor.'],
    ['Ca admin, deschide Jurnal modificări.', 'Vezi evenimentele companiei, inclusiv confirmările forțate de avize, dacă au existat.'],
  ]);

tc('TransitiX > App șofer', 'Șoferul vede doar cursele lui',
  'Contul de șofer nu deschide biroul.',
  'Profil TransitiX. sofer@transitix.ro / sofer123. Șoferul are cel puțin o cursă alocată.',
  'High', [
    ['Autentifică-te ca șofer.', 'Aterizezi în App Șofer, cu cursele alocate lui. Nu vezi Dispecerat, Financiar sau utilizatorii.'],
  ]);

tc('TransitiX > App șofer', 'Șoferul marchează încărcarea',
  'Primul pas din flux mută cursa din Alocată.',
  'Profil TransitiX. Șoferul are o cursă Alocată.',
  'High', [
    ['În App Șofer apasă Am încărcat.', 'Statusul devine Încărcată și în aplicația șoferului, și în Curse din birou.'],
  ]);

tc('TransitiX > App șofer', 'Poză CMR se încarcă pe cursa alocată',
  'Fișierul rămâne legat de cursă și cere login ca să fie văzut.',
  'Profil TransitiX, autentificat ca șoferul alocat pe cursă.',
  'Medium', [
    ['Încarcă o poză CMR pe cursă.', 'Poza se salvează pe cursă. URL-ul ei, deschis fără sesiune, nu descarcă fișierul.'],
  ]);

tc('TransitiX > Portal client', 'Linkul valid deschide confirmarea fără login de birou',
  'Clientul nu are cont.',
  'Există un link /confirm/<token> pentru o livrare. Fereastră privată, fără sesiune.',
  'High', [
    ['Deschide linkul.', 'Vezi CMR-ul și poți înregistra confirmarea. Nu apare loginul de birou.'],
    ['Confirmă.', 'Apare Confirmare înregistrată. În birou, livrarea reflectă confirmarea.'],
  ]);

tc('TransitiX > Portal client', 'Tokenul invalid nu confirmă nimic',
  'Un link ghicit nu închide o livrare.',
  'Fereastră privată.',
  'High', [
    ['Deschide /confirm/token-care-nu-exista.', 'Vezi Link invalid sau expirat. Nu se înregistrează nicio confirmare.'],
  ]);

tc('TransitiX > Portal client', 'Aceeași confirmare nu se înregistrează de două ori',
  'Reîncărcarea linkului după confirmare nu mai trimite o dată.',
  'Linkul tocmai a fost confirmat.',
  'Medium', [
    ['Redeschide același link.', 'Vezi că confirmarea este deja înregistrată. Nu se creează o a doua confirmare.'],
  ]);

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const header = ['folder', 'title', 'description', 'precondition', 'priority', 'steps', 'expected_result'];
const lines = [header.join(',')];
for (const item of cases) {
  for (const [action, expected] of item.steps) {
    lines.push([
      item.folder,
      item.title,
      item.description,
      item.precondition,
      item.priority,
      action,
      expected,
    ].map(csvCell).join(','));
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'transitix-test-cases.csv');
writeFileSync(out, `\uFEFF${lines.join('\r\n')}\n`, 'utf8');
const titles = new Set(cases.map((c) => `${c.folder}::${c.title}`));
console.log(`cases=${titles.size} rows=${lines.length - 1} file=${out}`);
