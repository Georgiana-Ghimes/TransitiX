# OCR #64 reopen — Cantitate pe retur doar paleți

WA0037 / TPO-0033293: Tip `paleți` OK, Cantitate goală pe OCR real (fixture curat trecea).

Cauze: `15.00` și `pce` pe linii separate; sau `quantityFromPalletsOnly` rula doar când `collectPackagingLines` era gol (zgomot `1 pal` bloca calea).

Fix: cross-line `N\npce`, `isPalletOnlyReturnPage`, preferință pce peste zgomot pal.
