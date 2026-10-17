# OCR #63 reopen — ignore `m3/pal` density

WA0031 / PSL-0062084: Tip m³ OK after #63, but Cantitate became **30.24** (= 28.80 + 1.44) because Descriere `(1.44 m3/pal)` was summed as volume.

Fix: `isPerPalletDensity` in `collectPackagingLines` / `extractGoodsUnit` skips `N m3` when followed by `/pal`.
