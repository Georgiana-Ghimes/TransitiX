# #82 — Tip marfă „paleți” în loc de „găleți”

## Problemă

`IMG-20261006-WA0056.jpg` (TPO-0033610): pe foaie `Numărul de găleți 192.00` (= 144+48 buc), plus `Palet Euro returnabil 8 pce` și „Paleți la locul livrării”. Cantitate 192 OK, Tip marfă = paleți.

## Cauză

OCR confundă des **găleți** cu **paleți** pe footerul `Numărul de …`. Extracția lua cuvântul din footer ca tip, deși liniile de produs sunt `buc` (găleți) și paleții euro sunt doar `pce`.

## Fix

Dacă footerul zice `paleți` dar pe pagină există linii `buc` (cu `(24/pal)` / produse tip găleți) a căror sumă = totalul din footer → tip/unitate **galeti**. Returul doar paleți (`Numărul de paleți` + doar `pce`) rămâne `paleti`.
