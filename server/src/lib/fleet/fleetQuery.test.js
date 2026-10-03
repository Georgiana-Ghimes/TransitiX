import { describe, expect, it } from 'vitest';
import {
  buildFleetCountQuery,
  buildFleetListQuery,
  capFleetIds,
  FLEET_DEFAULT_PAGE_SIZE,
  normalizeFleetPage,
} from './fleetQuery.js';

describe('fleetQuery', () => {
  it('paginates with an allowed page size and offset', () => {
    const { sql, params, page } = buildFleetListQuery({
      companyId: 'co',
      limit: 100,
      offset: 40,
    });
    expect(sql).toMatch(/is_active IS NOT FALSE/);
    expect(sql).toMatch(/ORDER BY plate ASC/);
    expect(sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(page).toEqual({ limit: 100, offset: 40 });
    expect(params.slice(-2)).toEqual([100, 40]);
  });

  it('searches by plate', () => {
    const { sql, params } = buildFleetListQuery({
      companyId: 'co',
      q: 'VFM',
      limit: 20,
      offset: 0,
    });
    expect(sql).toMatch(/strpos\(lower\(COALESCE\(plate/);
    expect(params).toContain('VFM');
  });

  it('accepts any page size from 1 to 500; unknown falls back', () => {
    expect(normalizeFleetPage({ limit: 999, offset: -2 }))
      .toEqual({ limit: FLEET_DEFAULT_PAGE_SIZE, offset: 0 });
    expect(normalizeFleetPage({ limit: 1, offset: 0 }))
      .toEqual({ limit: 1, offset: 0 });
  });

  it('counts with the same filters as the list, including missing MTMA', () => {
    const filters = { companyId: 'co', q: 'B-1' };
    const list = buildFleetListQuery({ ...filters, limit: 50, offset: 0 });
    const count = buildFleetCountQuery(filters);
    expect(count.sql).toMatch(/COUNT\(\*\)::int AS total/);
    expect(count.sql).toMatch(/missing_mma/);
    expect(count.sql).not.toMatch(/LIMIT/);
    expect(count.params).toEqual(list.params.slice(0, -2));
  });

  it('caps bulk id lists', () => {
    expect(capFleetIds(['a', 'a', 'b'].concat(Array.from({ length: 6000 }, (_, i) => String(i)))))
      .toHaveLength(5000);
  });
});
