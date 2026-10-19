import { describe, expect, it } from 'vitest';
import {
  avizDeliveryAddress, avizLoadingAddress, avizRouteZoneLegs, avizZoneTax, avizZoneTaxTrip,
  deliveryLegFromRuta, formatZoneTaxBreakdown, originLegFromRuta, parseSpacedRouteLeg,
  tractorPlate, zoneBracket, zoneMapHref, zoneTaxAutoFormPatch, zoneThresholdKg,
} from './avizZoneTax.js';

const FLEET = [
  { id: 'v1', plate: 'B-112-VFM', mma_kg: 19000, is_active: true },
  { id: 'v2', plate: 'B-34-BAU', mma_kg: null, is_active: true },
  { id: 'v3', plate: 'B-900-OLD', mma_kg: 19000, is_active: false },
];

const IN_ZONE_A = { zone: 'ZA', certain: true, source: 'street' };
const IN_ZONE_B = { zone: 'ZB', certain: true, source: 'street' };
const NO_ZONE = { zone: null, certain: true, source: 'street' };

const BUCHAREST = { street: 'viilor', number: '52', locality: 'Bucuresti', cityId: 'bucuresti', supported: true };

const AVIZ = {
  numar_auto: 'B-112-VFM',
  gross_weight_kg: 15744,
  delivery_address: { locality: 'Bucuresti', street: 'Viilor52', streetName: 'viilor', houseNumber: '52' },
};

const tax = (over = {}, opts = {}) => avizZoneTax({
  aviz: { ...AVIZ, ...over },
  vehicles: FLEET,
  zoneResult: IN_ZONE_A,
  address: BUCHAREST,
  ...opts,
});

describe('tractorPlate', () => {
  it('takes the tractor and leaves the trailer alone', () => {
    expect(tractorPlate('B-112-VFM / B-475-AGR')).toBe('B-112-VFM');
  });

  it('normalises what an operator typed with spaces', () => {
    expect(tractorPlate('b 112 vfm')).toBe('B-112-VFM');
  });

  it('refuses prose that OCR mistook for a plate', () => {
    expect(tractorPlate('330 SRS FOOTY STREAM')).toBeNull();
  });
});

describe('zoneBracket', () => {
  it('prices a 19 t lorry in Zone A from the 16 to 22 t row', () => {
    expect(zoneBracket('ZA', 19000).daily).toBe(2133);
  });

  it('prices the same lorry far cheaper in Zone B', () => {
    expect(zoneBracket('ZB', 19000).daily).toBe(363);
  });

  it('puts exactly 12.500 kg in the cheaper of the two rows that touch it', () => {
    // The brackets start at prevMax + 1 precisely so this boundary has one answer, not two.
    expect(zoneBracket('ZA', 12500).daily).toBe(711);
    expect(zoneBracket('ZA', 12501).daily).toBe(1421);
  });

  it('has an open top row, a 60 t crane does not fall off the table', () => {
    expect(zoneBracket('ZA', 60000).daily).toBe(3534);
  });

  it('knows nothing below the first row', () => {
    expect(zoneBracket('ZA', 4000)).toBeNull();
  });
});

describe('avizZoneTax, the fee', () => {
  it('charges the Zone A rate for the lorry MTMA, not for what it weighed', () => {
    const out = tax();
    expect(out.status).toBe('ok');
    // 15.744 kg on the weighbridge would have been the 12,5 to 16 t row at 1.421 lei. The
    // authorisation is bought against the 19 t on the registration, so it is 2.133 lei.
    expect(out.amount).toBe(2133);
    expect(out.mmaKg).toBe(19000);
    expect(out.grossKg).toBe(15744);
  });

  it('charges the Zone B rate when the delivery is in the outer zone', () => {
    expect(avizZoneTax({
      aviz: AVIZ, vehicles: FLEET, zoneResult: IN_ZONE_B, address: BUCHAREST,
    }).amount).toBe(363);
  });

  it('charges nothing outside the zones', () => {
    const out = avizZoneTax({
      aviz: AVIZ, vehicles: FLEET, zoneResult: NO_ZONE, address: BUCHAREST,
    });
    expect(out.status).toBe('outside');
    expect(out.amount).toBe(0);
  });

  it('charges nothing under the zone threshold, and still shows the listed row', () => {
    const light = [{ id: 'v9', plate: 'B-112-VFM', mma_kg: 6000, is_active: true }];
    const out = avizZoneTax({
      aviz: { ...AVIZ, gross_weight_kg: 5800 },
      vehicles: light,
      zoneResult: IN_ZONE_B,
      address: BUCHAREST,
    });
    expect(out.status).toBe('under_threshold');
    expect(out.amount).toBe(0);
    expect(out.bracket.daily).toBe(100);
  });
});

describe('avizZoneTax, when it refuses to compute', () => {
  it('computes nothing without a greutate brută', () => {
    expect(tax({ gross_weight_kg: null }).status).toBe('no_weight');
  });

  it('computes nothing from a weight no lorry can reach', () => {
    expect(tax({ gross_weight_kg: 157440 }).status).toBe('weight_implausible');
  });

  it('says the registry is wrong when the lorry outweighed its own MTMA', () => {
    // 22 t on the weighbridge under a registered 19 t: one of the two is wrong, and it is not
    // the weighbridge. Charging the 19 t row here would bill a year of trips from a bad figure.
    const out = tax({ gross_weight_kg: 22000 });
    expect(out.status).toBe('mma_suspect');
    expect(out.amount).toBeNull();
  });

  it('separates a street it does not have from a street with no zone', () => {
    const unknown = avizZoneTax({
      aviz: AVIZ, vehicles: FLEET, zoneResult: null, address: BUCHAREST,
    });
    expect(unknown.status).toBe('address_unknown');
    expect(unknown.amount).toBeNull();
  });

  it('asks rather than guesses when the house number decides', () => {
    const out = avizZoneTax({
      aviz: AVIZ,
      vehicles: FLEET,
      zoneResult: { zone: 'ZA', certain: false, needsNumber: true },
      address: BUCHAREST,
    });
    expect(out.status).toBe('address_unsure');
    expect(out.amount).toBeNull();
  });

  it('points at Autoturisme when the lorry has no MTMA', () => {
    const out = tax({ numar_auto: 'B-34-BAU' });
    expect(out.status).toBe('mma_missing');
    expect(out.vehicleId).toBe('v2');
  });

  it('does not price from a lorry that was retired from the fleet', () => {
    expect(tax({ numar_auto: 'B-900-OLD' }).status).toBe('vehicle_unknown');
  });

  it('reports an unreadable plate as unreadable, not as an unknown lorry', () => {
    expect(tax({ numar_auto: '330 SRS FOOTY STREAM' }).status).toBe('plate_invalid');
  });

  it('charges nothing for a delivery in a city with no index', () => {
    const out = avizZoneTax({
      aviz: AVIZ,
      vehicles: FLEET,
      zoneResult: null,
      address: { street: 'garii', locality: 'Domnesti', cityId: null, supported: false },
    });
    expect(out.status).toBe('outside_city');
  });

  it('checks the weight before anything else, an empty aviz asks for the weight', () => {
    const out = avizZoneTax({ aviz: {}, vehicles: [], zoneResult: null, address: null });
    expect(out.status).toBe('no_weight');
  });
});

describe('zoneMapHref', () => {
  it('builds a zone-map deep link with street, number, city and plate', () => {
    const href = zoneMapHref(
      {
        street: 'bulevardul Iuliu Maniu',
        number: '600A',
        locality: 'Bucuresti',
        cityId: 'bucuresti',
        supported: true,
      },
      { plate: 'B-34-BAU' },
    );
    expect(href).toBe(
      '/zone-map?q=bulevardul+Iuliu+Maniu+600A&city=bucuresti&plate=B-34-BAU',
    );
  });

  it('includes locality in q when the delivery is outside a zoned city', () => {
    const href = zoneMapHref(
      {
        street: 'strada Republicii',
        number: '1F',
        locality: 'Bolintin-Deal',
        cityId: null,
        supported: false,
      },
      { plate: 'B-34-BAU' },
    );
    expect(href).toBe(
      '/zone-map?q=strada+Republicii+1F%2C+Bolintin-Deal&locality=Bolintin-Deal&plate=B-34-BAU',
    );
  });

  it('includes OCR postcode in q and as postcode= for map geocode', () => {
    const href = zoneMapHref(
      {
        street: 'bulevardul Pipera',
        number: '1/VII',
        locality: 'Voluntari',
        cityId: null,
        supported: false,
        postcode: '077190',
      },
      { plate: 'B-404-RZC' },
    );
    expect(href).toContain('q=bulevardul+Pipera+1%2FVII%2C+Voluntari%2C+077190');
    expect(href).toContain('locality=Voluntari');
    expect(href).toContain('postcode=077190');
    expect(href).toContain('plate=B-404-RZC');
  });

  it('keeps OCR postcode when the route leg wins over delivery_address', () => {
    const addr = avizDeliveryAddress({
      ruta_transport: 'BOL / Bvd. Pipera nr. 52, Voluntari',
      delivery_address: {
        locality: 'Voluntari',
        streetName: 'pipera',
        streetType: 'bulevardul',
        houseNumber: '52',
        postcode: '077190',
      },
    });
    expect(addr.postcode).toBe('077190');
    expect(addr.locality).toBe('Voluntari');
    expect(zoneMapHref(addr)).toContain('postcode=077190');
  });

  it('opens Șos. Viilor 52 on the Bucharest index, not as a non-zoned locality', () => {
    const href = zoneMapHref(
      avizDeliveryAddress({
        ruta_transport: 'BOL / Șoseaua Viilor nr. 52, sector 5, București',
      }),
      { plate: 'B 112 VFM / B 475 AGR' },
    );
    expect(href).toBe(
      '/zone-map?q=soseaua+Viilor+52&city=bucuresti&plate=B+112+VFM+%2F+B+475+AGR',
    );
    expect(href).not.toMatch(/locality=/);
  });

  it('returns null when there is no street to open on the map', () => {
    expect(zoneMapHref({ street: null, number: '52' })).toBeNull();
  });
});

describe('originLegFromRuta / avizLoadingAddress (#97)', () => {
  it('takes the first leg as loading', () => {
    expect(originLegFromRuta(
      'Bvd. Iuliu Maniu nr. 220, Bucuresti / Șosea Viilor nr. 52, Bucuresti',
    )).toBe('Bvd. Iuliu Maniu nr. 220, Bucuresti');
  });

  it('returns null on a single-leg route (no separate loading end)', () => {
    expect(originLegFromRuta('Șosea Viilor nr. 52, Bucuresti')).toBeNull();
  });

  it('builds a street address from the loading leg', () => {
    expect(avizLoadingAddress({
      ruta_transport: 'Bvd. Iuliu Maniu nr. 220, Bucuresti / Șosea Viilor nr. 52, Bucuresti',
    })).toMatchObject({
      street: 'bulevardul Iuliu Maniu',
      number: '220',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    });
  });

  it('cannot zone a site-code loading leg', () => {
    expect(avizLoadingAddress({
      ruta_transport: 'MIL-NEAMTIU / Șosea Viilor nr. 52, Bucuresti',
    })).toBeNull();
  });
});

describe('avizZoneTaxTrip (delivery only)', () => {
  const loadAddr = {
    street: 'bulevardul Iuliu Maniu', number: '220',
    locality: 'Bucuresti', cityId: 'bucuresti', supported: true,
  };
  const unloadAddr = {
    street: 'soseaua Viilor', number: '52',
    locality: 'Bucuresti', cityId: 'bucuresti', supported: true,
  };
  const unloadPloiesti = {
    street: 'strada Gheorghe Doja', number: '51',
    locality: 'Ploiesti', cityId: null, supported: false,
  };

  it('never charges the Expeditor / încărcare leg even if it is in a taxed zone', () => {
    const out = avizZoneTaxTrip({
      aviz: AVIZ,
      vehicles: FLEET,
      legs: [
        { role: 'incarcare', address: loadAddr, zoneResult: IN_ZONE_A },
        { role: 'livrare', address: unloadAddr, zoneResult: IN_ZONE_B },
      ],
    });
    expect(out.status).toBe('ok');
    expect(out.amount).toBe(363);
    expect(out.zones).toEqual(['ZB']);
    expect(out.legs).toHaveLength(1);
    expect(out.legs[0].role).toBe('livrare');
  });

  it('charges each distinct delivery zone once (multi-stop unload)', () => {
    const unloadA = {
      street: 'bulevardul Aviatorilor', number: '72',
      locality: 'Bucuresti', cityId: 'bucuresti', supported: true,
    };
    const out = avizZoneTaxTrip({
      aviz: AVIZ,
      vehicles: FLEET,
      legs: [
        { role: 'livrare', label: 'Livrare 1', address: unloadA, zoneResult: IN_ZONE_A },
        { role: 'livrare', label: 'Livrare 2', address: unloadAddr, zoneResult: IN_ZONE_B },
      ],
    });
    expect(out.amount).toBe(2133 + 363);
    expect(out.zones).toEqual(['ZA', 'ZB']);
  });

  it('ignores a site-code Expeditor and prices only delivery', () => {
    const out = avizZoneTaxTrip({
      aviz: {
        ...AVIZ,
        ruta_transport: 'MIL-NEAMTIU / Șosea Viilor nr. 52, Bucuresti',
      },
      vehicles: FLEET,
      legs: [
        { role: 'incarcare', address: null, zoneResult: null, raw: 'MIL-NEAMTIU' },
        { role: 'livrare', address: unloadAddr, zoneResult: IN_ZONE_B },
      ],
    });
    expect(out.legs).toHaveLength(1);
    expect(out.amount).toBe(363);
    expect(out.zones).toEqual(['ZB']);
  });

  it('formats a reportable breakdown of charged delivery zones', () => {
    const out = avizZoneTaxTrip({
      aviz: AVIZ,
      vehicles: FLEET,
      legs: [
        { role: 'incarcare', label: 'Încărcare', address: loadAddr, zoneResult: IN_ZONE_A },
        { role: 'livrare', label: 'Livrare', address: unloadAddr, zoneResult: IN_ZONE_B },
      ],
    });
    expect(formatZoneTaxBreakdown(out)).not.toMatch(/ZA/);
    expect(formatZoneTaxBreakdown(out)).toMatch(/ZB/);
    expect(out.total).toBe(363);
    expect(out.chargeLines).toHaveLength(1);
  });

  it('does not invent a fee from an unsupported delivery locality', () => {
    const out = avizZoneTaxTrip({
      aviz: AVIZ,
      vehicles: FLEET,
      legs: [
        { role: 'livrare', address: unloadPloiesti, zoneResult: null },
      ],
    });
    expect(out.status).toBe('outside_city');
    expect(out.amount).toBeNull();
  });
});

describe('avizRouteZoneLegs (delivery only)', () => {
  it('skips Expeditor and keeps every unload stop on a multi-delivery route', () => {
    const legs = avizRouteZoneLegs({
      ruta_transport:
        'Bvd. Iuliu Maniu nr. 220, Bucuresti / Str. Gheorghe Doja nr. 51, Ploiesti / Șosea Viilor nr. 52, Bucuresti',
    });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.label)).toEqual(['Livrare 1', 'Livrare 2']);
    expect(legs.every((l) => l.role === 'livrare')).toBe(true);
    expect(legs[0].address.locality).toMatch(/Ploiesti/i);
    expect(legs[1].address.street).toMatch(/viilor/i);
  });

  it('does not expose the Expeditor street as a tax leg', () => {
    const legs = avizRouteZoneLegs({
      ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti',
    });
    expect(legs).toHaveLength(1);
    expect(legs[0].label).toBe('Livrare');
    expect(legs[0].address.street).toMatch(/viilor/i);
    expect(JSON.stringify(legs)).not.toMatch(/Republicii|Bolintin/i);
  });
});

describe('deliveryLegFromRuta / parseSpacedRouteLeg', () => {
  it('takes the half after the slash', () => {
    expect(deliveryLegFromRuta(
      'Str. Republicii nr. 1F, Bolintin-Deal / Bvd. Iuliu Maniu nr. 600A, Bucuresti',
    )).toBe('Bvd. Iuliu Maniu nr. 600A, Bucuresti');
  });

  it('takes the delivery leg after → / -> / spaced - the same as after / (#71)', () => {
    const dest = 'Șoseaua Viilor nr. 52, București';
    expect(deliveryLegFromRuta(`BOL Bolintin → ${dest}`)).toBe(dest);
    expect(deliveryLegFromRuta(`BOL Bolintin -> ${dest}`)).toBe(dest);
    expect(deliveryLegFromRuta(`BOL Bolintin - ${dest}`)).toBe(dest);
    expect(deliveryLegFromRuta(`BOL Bolintin / ${dest}`)).toBe(dest);
    // Glued hyphen in a place name is not a leg separator.
    expect(deliveryLegFromRuta('Str. Republicii nr. 1F, Bolintin-Deal')).toBe(
      'Str. Republicii nr. 1F, Bolintin-Deal',
    );
  });

  it('prefers the București stop on a multi-delivery route (#61)', () => {
    expect(deliveryLegFromRuta(
      'Str. Industriei nr. 7, Bolintin-Deal / Str. Gheorghe Doja nr. 51, Ploiesti / Bvd. Aviatorilor nr. 72, Bucuresti',
    )).toBe('Bvd. Aviatorilor nr. 72, Bucuresti');
  });

  it('still finds București when it is not the last stop (#61)', () => {
    expect(deliveryLegFromRuta(
      'Str. Industriei nr. 7, Bolintin-Deal / Bvd. Aviatorilor nr. 72, Bucuresti / Str. Gheorghe Doja nr. 51, Ploiesti',
    )).toBe('Bvd. Aviatorilor nr. 72, Bucuresti');
  });

  it('parses type, name, number and locality for the street index', () => {
    expect(parseSpacedRouteLeg('Bvd. Iuliu Maniu nr. 600A, Bucuresti')).toEqual({
      street: 'bulevardul Iuliu Maniu',
      number: '600A',
      locality: 'Bucuresti',
      streetName: 'Iuliu Maniu',
      streetType: 'bulevardul',
    });
  });

  it('parses Șoseaua and keeps a sector+city locality for the city check', () => {
    expect(parseSpacedRouteLeg('Șoseaua Viilor nr. 52, sector 5, București')).toEqual({
      street: 'soseaua Viilor',
      number: '52',
      locality: 'sector 5, București',
      streetName: 'Viilor',
      streetType: 'soseaua',
    });
  });

  it('parses a numbered street without inventing a locality from nr. 52', () => {
    expect(parseSpacedRouteLeg('Șoseaua Viilor nr. 52')).toMatchObject({
      street: 'soseaua Viilor',
      number: '52',
      locality: null,
    });
  });
});

describe('avizDeliveryAddress', () => {
  it('reads the street and number OCR kept apart from the route code', () => {
    expect(avizDeliveryAddress(AVIZ)).toEqual({
      street: 'viilor',
      number: '52',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
      postcode: null,
    });
  });

  it('keeps the type word the document printed, because three Viilor streets disagree', () => {
    // Intrarea Viilor is in Zone B, Șoseaua Viilor is in Zone B, Strada Viilor is in neither.
    // The aviz says "Șosea Viilor" and that settles it; the bare name is a question.
    const out = avizDeliveryAddress({
      delivery_address: {
        locality: 'Bucuresti', streetName: 'viilor', streetType: 'sosea', houseNumber: '52',
      },
    });
    expect(out.street).toBe('soseaua viilor');
  });

  it('prefers the delivery leg of ruta_transport over OCR delivery_address', () => {
    const out = avizDeliveryAddress({
      ruta_transport: 'Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti',
      delivery_address: {
        locality: 'Fundeni', streetName: 'locotenent moga', streetType: 'strada', houseNumber: '18',
      },
    });
    expect(out).toMatchObject({
      street: 'soseaua Viilor',
      number: '52',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    });
  });

  it('resolves zone-tax address the same for → and / (#71)', () => {
    const dest = 'Șoseaua Viilor nr. 52, București';
    const expected = {
      street: 'soseaua Viilor',
      number: '52',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    };
    expect(avizDeliveryAddress({ ruta_transport: dest })).toMatchObject(expected);
    expect(avizDeliveryAddress({ ruta_transport: `BOL Bolintin → ${dest}` })).toMatchObject(expected);
    expect(avizDeliveryAddress({ ruta_transport: `BOL Bolintin -> ${dest}` })).toMatchObject(expected);
    expect(avizDeliveryAddress({ ruta_transport: `BOL Bolintin - ${dest}` })).toMatchObject(expected);
    expect(avizDeliveryAddress({ ruta_transport: `BOL Bolintin / ${dest}` })).toMatchObject(expected);
  });

  it('uses the București stop on a multi-delivery route for zone tax (#61)', () => {
    const out = avizDeliveryAddress({
      ruta_transport:
        'Str. Industriei nr. 7, Bolintin-Deal / Str. Gheorghe Doja nr. 51, Ploiesti / Bvd. Aviatorilor nr. 72, Bucuresti',
    });
    expect(out).toMatchObject({
      street: 'bulevardul Aviatorilor',
      number: '72',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    });
  });

  it('treats sector 5, București as Bucharest, not as a town with no zones', () => {
    // PSL-0056102 / TPO-0032203: Șos. Viilor 52, BOL. Exact locality "bucuresti" used to miss.
    const out = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52, sector 5, București',
    });
    expect(out).toMatchObject({
      street: 'soseaua Viilor',
      number: '52',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    });
  });

  it('fills București from OCR when the route names the street but not the city', () => {
    const out = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52',
      delivery_address: {
        locality: 'sector 5, București',
        streetName: 'Viilor',
        streetType: 'soseaua',
        houseNumber: '52',
      },
    });
    expect(out.supported).toBe(true);
    expect(out.cityId).toBe('bucuresti');
    expect(out.street).toBe('soseaua Viilor');
  });

  it('assumes București when the route has street+nr but no locality at all (#48/#79, #53 matrice Loki)', () => {
    // Matrice Loki FAIL: ruta="BOL / Șoseaua Viilor nr. 52" → outside_city + href null.
    const out = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52',
    });
    expect(out).toMatchObject({
      street: 'soseaua Viilor',
      number: '52',
      locality: 'Bucuresti',
      cityId: 'bucuresti',
      supported: true,
    });
    expect(zoneMapHref(out)).toBe('/zone-map?q=soseaua+Viilor+52&city=bucuresti');
  });

  it('treats bare sector 5 as București', () => {
    const out = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52, sector 5',
    });
    expect(out.cityId).toBe('bucuresti');
    expect(out.supported).toBe(true);
  });

  it('marks a locality with no index as unsupported rather than as unknown', () => {
    const out = avizDeliveryAddress({
      delivery_address: { locality: 'Domnesti', streetName: 'garii', houseNumber: '3' },
    });
    expect(out.supported).toBe(false);
    expect(out.cityId).toBeNull();
  });

  it('survives an aviz with no parsed address at all', () => {
    expect(avizDeliveryAddress({}).street).toBeNull();
    expect(avizDeliveryAddress({}).supported).toBe(false);
  });
});

describe('resolveAvizZone for Șos. Viilor 52', () => {
  it('answers Zone B from the shipped index (even numbers 4–98)', async () => {
    const { resolveAvizZone } = await import('./avizZoneTax.js');
    const address = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52, sector 5, București',
    });
    const zone = await resolveAvizZone(address);
    expect(zone).toMatchObject({ zone: 'ZB', certain: true });
  });

  it('answers Zone B even when OCR never wrote București on the route', async () => {
    const { resolveAvizZone } = await import('./avizZoneTax.js');
    const address = avizDeliveryAddress({
      ruta_transport: 'BOL / Șoseaua Viilor nr. 52',
    });
    const zone = await resolveAvizZone(address);
    expect(zone).toMatchObject({ zone: 'ZB', certain: true });
  });
});

describe('zoneThresholdKg', () => {
  it('knows both Bucharest thresholds', () => {
    expect(zoneThresholdKg('ZA')).toBe(5000);
    expect(zoneThresholdKg('ZB')).toBe(7500);
  });

  it('has no threshold for a zone somebody invented', () => {
    expect(zoneThresholdKg('ZZ')).toBeNull();
  });
});

describe('zoneTaxAutoFormPatch (live refresh on address edit)', () => {
  it('fills Taxe suplimentare from a new zone fee', () => {
    expect(zoneTaxAutoFormPatch({
      amount: 2133,
      breakdown: 'ZA 2.133 lei',
      taxeSuplimentare: '',
      zoneTaxBreakdown: '',
      lastAutoAmount: null,
    })).toEqual({
      lastAutoAmount: 2133,
      patch: { taxe_suplimentare: '2133', zone_tax_breakdown: 'ZA 2.133 lei' },
    });
  });

  it('updates the auto amount when the address moves to another zone', () => {
    expect(zoneTaxAutoFormPatch({
      amount: 363,
      breakdown: 'ZB 363 lei',
      taxeSuplimentare: '2133',
      zoneTaxBreakdown: 'ZA 2.133 lei',
      lastAutoAmount: 2133,
    })).toEqual({
      lastAutoAmount: 363,
      patch: { taxe_suplimentare: '363', zone_tax_breakdown: 'ZB 363 lei' },
    });
  });

  it('clears a stale auto tax when the address leaves the zoned area', () => {
    expect(zoneTaxAutoFormPatch({
      amount: null,
      breakdown: '',
      taxeSuplimentare: '2133',
      zoneTaxBreakdown: 'ZA 2.133 lei',
      lastAutoAmount: 2133,
    })).toEqual({
      lastAutoAmount: null,
      patch: { taxe_suplimentare: '', zone_tax_breakdown: '' },
    });
  });

  it('does not overwrite a tax the operator typed by hand', () => {
    expect(zoneTaxAutoFormPatch({
      amount: 363,
      breakdown: 'ZB 363 lei',
      taxeSuplimentare: '5000',
      zoneTaxBreakdown: '',
      lastAutoAmount: 2133,
    })).toEqual({ lastAutoAmount: 2133, patch: null });
  });
});
