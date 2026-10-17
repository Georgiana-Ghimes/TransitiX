# OCR #63: marfă în m³ citită ca paleți

`28.80 m³` + `Palet Euro returnabil 20.00 pce` devenea Tip paleți / Cantitate 20 (sau 3).

- Cifra din `m3` se lipea peste newline de `Palet` → fals „3 paleți”; gap-ul număr–unitate e doar pe același rând.
- `m³` / `m3` / `mc` sunt unități de marfă; paleții euro `pce` rămân ignorați.
- Cantitate în Editează acceptă deja zecimale (`step=0.001`).
