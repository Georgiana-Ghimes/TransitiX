# #71: Taxă zonă — separator →/->/- pe Rută

Cu `BOL → Șoseaua Viilor nr. 52, București`, taxa spunea „strada nu e în index”; aceeași destinație după ` / ` sau singură calcula ZB.

- `deliveryLegFromRuta` taie pe `→`, `->`, `–`, ` - ` și ` / ` (nu pe hyphen lipit din Bolintin-Deal).
- Piciorul de livrare (preferat București) e același indiferent de separator.
