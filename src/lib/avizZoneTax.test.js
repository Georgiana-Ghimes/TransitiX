import { describe, expect, it } from 'vitest';
import {
  avizDeliveryAddress, avizZoneTax, tractorPlate, zoneBracket, zoneThresholdKg,
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

describe('avizDeliveryAddress', () => {
  it('reads the street and number OCR kept apart from the route code', () => {
    expect(avizDeliveryAddress(AVIZ)).toEqual({
      street: 'viilor', number: '52', locality: 'Bucuresti', cityId: 'bucuresti', supported: true,
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
    expect(out.street).toBe('sosea viilor');
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

describe('zoneThresholdKg', () => {
  it('knows both Bucharest thresholds', () => {
    expect(zoneThresholdKg('ZA')).toBe(5000);
    expect(zoneThresholdKg('ZB')).toBe(7500);
  });

  it('has no threshold for a zone somebody invented', () => {
    expect(zoneThresholdKg('ZZ')).toBeNull();
  });
});
