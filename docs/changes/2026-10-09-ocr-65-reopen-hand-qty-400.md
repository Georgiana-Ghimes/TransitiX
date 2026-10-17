# OCR #65 reopen — manuscris 400 citit ca 40

WA0027: HITL + greutate 10193,83 OK; Cantitate era **40** (OCR a pierdut un zero din 400 lângă 432.00 sac tăiat).

Fix: `recoverTruncatedHandQty` — dacă candidatul e ≤99 și ×10 e o reducere plauzibilă a tipăritului, folosește ×10; elimină truncări când există și forma completă (40 vs 400).
