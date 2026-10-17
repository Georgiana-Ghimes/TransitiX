# OCR #61: două adrese de livrare + taxă zonă București

Avizul cu „Adrese de livrare” / Livrare 1 + Livrare 2 lăsa ruta doar pe expeditor; taxa de zonă spunea „nu e oraș taxat” deși stopul 2 e București.

- `parseDeliveryAddresses` taie pe Livrare N; ruta = origine / fiecare stop.
- `delivery_address` și `deliveryLegFromRuta` preferă oprirea din București.
- Localitate după virgulă înainte de `RO #####` (ex. `nr. 7, Bolintin-Deal, RO …`).
