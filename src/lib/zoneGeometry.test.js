import { describe, expect, it } from 'vitest';
import {
  ZoneImportError,
  combinedBounds,
  geometryBounds,
  geometrySummary,
  geometryToRings,
  looksLikePlausibleOutline,
  parseKmlCoordinates,
  parseKmlPolygons,
  parseZoneOutlines,
  ringMetrics,
  dropSliverHoles,
  findSpikeVertices,
} from './zoneGeometry.js';

const square = {
  type: 'Polygon',
  coordinates: [[[26.0, 44.4], [26.2, 44.4], [26.2, 44.5], [26.0, 44.5], [26.0, 44.4]]],
};

describe('geometryToRings', () => {
  it('swaps GeoJSON lon/lat into Leaflet lat/lon', () => {
    // The whole point of routing every draw through this helper: GeoJSON is lon/lat and
    // Leaflet is lat/lon, and a zone drawn transposed lands in the Indian Ocean.
    expect(geometryToRings(square)[0][0]).toEqual([44.4, 26.0]);
  });

  it('returns holes as their own rings', () => {
    const withHole = {
      type: 'Polygon',
      coordinates: [
        square.coordinates[0],
        [[26.05, 44.42], [26.1, 44.42], [26.1, 44.45], [26.05, 44.45], [26.05, 44.42]],
      ],
    };
    expect(geometryToRings(withHole)).toHaveLength(2);
  });

  it('flattens a MultiPolygon', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates] };
    expect(geometryToRings(multi)).toHaveLength(2);
  });

  it('drops rings too short to enclose anything', () => {
    const degenerate = { type: 'Polygon', coordinates: [[[26.0, 44.4], [26.2, 44.4]]] };
    expect(geometryToRings(degenerate)).toEqual([]);
  });

  it('survives a Feature, a null and a LineString without throwing', () => {
    // tax_zones.polygon is a bare geometry; territories.polygon is a Feature. Handing the
    // wrong one over must draw nothing, not crash the screen.
    expect(geometryToRings({ type: 'Feature', geometry: square })).toEqual([]);
    expect(geometryToRings(null)).toEqual([]);
    expect(geometryToRings({ type: 'LineString', coordinates: [[26, 44], [26.1, 44.1]] })).toEqual([]);
  });
});

describe('bounds', () => {
  it('fits one geometry', () => {
    expect(geometryBounds(square)).toEqual([[44.4, 26.0], [44.5, 26.2]]);
  });

  it('is null when there is nothing to fit', () => {
    expect(geometryBounds(null)).toBeNull();
    expect(combinedBounds([null, undefined])).toBeNull();
  });

  it('covers several zones at once', () => {
    const other = {
      type: 'Polygon',
      coordinates: [[[25.9, 44.3], [26.0, 44.3], [26.0, 44.35], [25.9, 44.35], [25.9, 44.3]]],
    };
    expect(combinedBounds([square, other])).toEqual([[44.3, 25.9], [44.5, 26.2]]);
  });

  it('counts rings and points for the sidebar', () => {
    expect(geometrySummary(square)).toEqual({ rings: 1, points: 5 });
  });
});

describe('parseKmlCoordinates', () => {
  it('reads lon,lat tuples and drops altitude', () => {
    expect(parseKmlCoordinates('26.0,44.4,0 26.2,44.4,0')).toEqual([[26.0, 44.4], [26.2, 44.4]]);
  });

  it('keeps altitude out of the stored position', () => {
    // pointInPolygon reads coordinates positionally, so a stray third ordinate would not just
    // be ignored — it would shift nothing and silently pass, which is worse than failing.
    expect(parseKmlCoordinates('26.0,44.4,120').every((p) => p.length === 2)).toBe(true);
  });

  it('ignores newlines, tabs and junk tuples', () => {
    expect(parseKmlCoordinates('\n  26.0,44.4\n\t26.2,44.4\n  bad \n')).toEqual([
      [26.0, 44.4], [26.2, 44.4],
    ]);
  });
});

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Zona A</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    26.0,44.4,0 26.2,44.4,0 26.2,44.5,0 26.0,44.5,0 26.0,44.4,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

describe('parseKmlPolygons', () => {
  it('reads an outer boundary', () => {
    const polys = parseKmlPolygons(kml);
    expect(polys).toHaveLength(1);
    expect(polys[0][0]).toHaveLength(5);
  });

  it('keeps holes as inner rings', () => {
    const withHole = kml.replace('</Polygon>', `<innerBoundaryIs><LinearRing><coordinates>
      26.05,44.42 26.1,44.42 26.1,44.45 26.05,44.45 26.05,44.42
    </coordinates></LinearRing></innerBoundaryIs></Polygon>`);
    expect(parseKmlPolygons(withHole)[0]).toHaveLength(2);
  });

  it('closes a ring the file left open', () => {
    const open = kml.replace(' 26.0,44.4,0\n', '\n');
    const ring = parseKmlPolygons(open)[0][0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('tolerates namespace prefixes', () => {
    const prefixed = kml.replace(/<(\/?)(Polygon|outerBoundaryIs|LinearRing|coordinates)/g, '<$1kml:$2');
    expect(parseKmlPolygons(prefixed)).toHaveLength(1);
  });

  it('reads every polygon of a MultiGeometry', () => {
    const multi = kml.replace(
      '<Polygon>',
      '<MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>'
      + '25.9,44.3 26.0,44.3 26.0,44.35 25.9,44.35 25.9,44.3'
      + '</coordinates></LinearRing></outerBoundaryIs></Polygon><Polygon>',
    ).replace('</Placemark>', '</MultiGeometry></Placemark>');
    expect(parseKmlPolygons(multi)).toHaveLength(2);
  });

  it('ignores geometry that is not a polygon', () => {
    const line = kml.replace(/Polygon/g, 'LineString');
    expect(parseKmlPolygons(line)).toEqual([]);
  });
});

describe('parseZoneOutlines', () => {
  const one = (text, name) => {
    const outlines = parseZoneOutlines(text, name);
    expect(outlines).toHaveLength(1);
    return outlines[0].geometry;
  };

  it('reads a bare GeoJSON geometry', () => {
    expect(one(JSON.stringify(square), 'zona.geojson')).toEqual(square);
  });

  it('unwraps a Feature and carries its name', () => {
    const feature = { type: 'Feature', properties: { name: 'Zona A' }, geometry: square };
    const collection = { type: 'FeatureCollection', features: [feature] };
    const [outline] = parseZoneOutlines(JSON.stringify(collection), 'a.json');
    expect(outline.name).toBe('Zona A');
    expect(outline.geometry).toEqual(square);
  });

  it('keeps two features apart instead of merging them', () => {
    // The merging version handed whichever zone was being imported the union of both rings,
    // so every address in the outer zone resolved to the inner zone's stricter tariff.
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Zona A' }, geometry: square },
        { type: 'Feature', properties: { name: 'Zona B' }, geometry: square },
      ],
    };
    const outlines = parseZoneOutlines(JSON.stringify(collection), 'a.json');
    expect(outlines.map((o) => o.name)).toEqual(['Zona A', 'Zona B']);
    expect(outlines.every((o) => o.geometry.type === 'Polygon')).toBe(true);
  });

  it('reads KML by extension and by content sniffing', () => {
    expect(one(kml, 'Bucuresti.kml').type).toBe('Polygon');
    expect(one(kml, 'no-extension').type).toBe('Polygon');
  });

  it('names each KML placemark', () => {
    expect(parseZoneOutlines(kml, 'a.kml')[0].name).toBe('Zona A');
  });

  it('keeps a placemark with holes as one outline', () => {
    const withHole = kml.replace('</Polygon>', `<innerBoundaryIs><LinearRing><coordinates>
      26.05,44.42 26.1,44.42 26.1,44.45 26.05,44.45 26.05,44.42
    </coordinates></LinearRing></innerBoundaryIs></Polygon>`);
    const [outline] = parseZoneOutlines(withHole, 'a.kml');
    expect(outline.geometry.coordinates).toHaveLength(2);
  });

  it('explains a NetworkLink instead of reporting a broken export', () => {
    // The file an operator downloads from a My Maps share is often just a pointer. "No
    // polygons" would send them hunting for a corrupt file that is doing exactly its job.
    const link = `<?xml version="1.0"?><kml><Document><name>Zone</name><NetworkLink><Link>
      <href><![CDATA[https://example.test/kml?mid=abc]]></href>
    </Link></NetworkLink></Document></kml>`;
    expect(() => parseZoneOutlines(link, 'zone.kml')).toThrow(/doar un link/);
    expect(() => parseZoneOutlines(link, 'zone.kml')).toThrow(/example\.test/);
  });

  it('names what is wrong instead of importing an empty zone', () => {
    expect(() => parseZoneOutlines('', 'a.geojson')).toThrow(ZoneImportError);
    expect(() => parseZoneOutlines('not json', 'a.geojson')).toThrow(/GeoJSON valid/);
    expect(() => parseZoneOutlines('<kml><Document/></kml>', 'a.kml')).toThrow(/Polygon/);
    expect(() => parseZoneOutlines(JSON.stringify({ type: 'Point', coordinates: [26, 44] }), 'a.json'))
      .toThrow(/poligon/i);
  });

  it('refuses a KMZ instead of parsing the archive bytes as text', () => {
    expect(() => parseZoneOutlines('PKbinary', 'zone.kmz')).toThrow(/dezarhiveaz/i);
  });
});

describe('ringMetrics', () => {
  // ~1.1 km on a side at this latitude; the numbers only need the right order of magnitude.
  const squareRing = [[26.0, 44.4], [26.014, 44.4], [26.014, 44.41], [26.0, 44.41], [26.0, 44.4]];

  it('measures a square as roughly compact', () => {
    const { area, compactness } = ringMetrics(squareRing);
    expect(area).toBeGreaterThan(500_000);
    expect(compactness).toBeGreaterThan(0.6);
  });

  it('scores a ring that doubles back on itself near zero', () => {
    // This is the shape a self-intersection leaves behind: a long path enclosing nothing.
    const sliver = [[26.0, 44.4], [26.02, 44.42], [26.0200001, 44.4200001], [26.0, 44.4]];
    expect(ringMetrics(sliver).compactness).toBeLessThan(0.01);
  });

  it('is zero for a ring too short to enclose anything', () => {
    expect(ringMetrics([[26, 44], [26.1, 44]])).toEqual({ area: 0, perimeter: 0, compactness: 0 });
    expect(ringMetrics(null).area).toBe(0);
  });
});

describe('dropSliverHoles', () => {
  const outer = [[26.0, 44.4], [26.2, 44.4], [26.2, 44.5], [26.0, 44.5], [26.0, 44.4]];
  const sliver = [[26.05, 44.42], [26.07, 44.44], [26.0700001, 44.4400001], [26.05, 44.42]];
  const realHole = [[26.05, 44.42], [26.09, 44.42], [26.09, 44.45], [26.05, 44.45], [26.05, 44.42]];

  it('removes a hole that encloses nothing and says how many', () => {
    const { geometry, dropped } = dropSliverHoles({ type: 'Polygon', coordinates: [outer, sliver] });
    expect(dropped).toBe(1);
    expect(geometry.coordinates).toHaveLength(1);
  });

  it('keeps a real exclusion', () => {
    // Dropping a genuine hole would charge a zone fee inside an area deliberately carved out.
    const { geometry, dropped } = dropSliverHoles({ type: 'Polygon', coordinates: [outer, realHole] });
    expect(dropped).toBe(0);
    expect(geometry.coordinates).toHaveLength(2);
  });

  it('never touches the outer ring, however thin it is', () => {
    // A degenerate outer ring means a broken file. Silently tidying it would leave a zone that
    // covers nothing and quietly stops charging.
    const { geometry, dropped } = dropSliverHoles({ type: 'Polygon', coordinates: [sliver] });
    expect(dropped).toBe(0);
    expect(geometry.coordinates[0]).toEqual(sliver);
  });

  it('walks every polygon of a MultiPolygon', () => {
    const multi = { type: 'MultiPolygon', coordinates: [[outer, sliver], [outer, sliver]] };
    expect(dropSliverHoles(multi).dropped).toBe(2);
  });

  it('leaves anything that is not a polygon alone', () => {
    const line = { type: 'LineString', coordinates: [[26, 44], [26.1, 44.1]] };
    expect(dropSliverHoles(line)).toEqual({ geometry: line, dropped: 0 });
  });
});

describe('findSpikeVertices', () => {
  const smooth = [[26.0, 44.4], [26.02, 44.4], [26.02, 44.42], [26.0, 44.42], [26.0, 44.4]];

  it('finds nothing on a clean ring', () => {
    expect(findSpikeVertices(smooth)).toEqual([]);
  });

  it('finds a vertex the path leaves and returns along', () => {
    // ~800 m out and back at the same bearing: a slip of the cursor, not a boundary.
    const withSpike = [[26.0, 44.4], [26.01, 44.4], [26.0101, 44.408], [26.0102, 44.4], [26.02, 44.4],
      [26.02, 44.42], [26.0, 44.42], [26.0, 44.4]];
    const spikes = findSpikeVertices(withSpike);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].position).toEqual([26.0101, 44.408]);
    expect(spikes[0].angle).toBeLessThan(20);
  });

  it('ignores a sharp angle between two short segments', () => {
    // Real boundaries turn sharply at junctions; only a long excursion is a slip.
    const detail = [[26.0, 44.4], [26.0002, 44.4], [26.00021, 44.4001], [26.0004, 44.4],
      [26.02, 44.4], [26.02, 44.42], [26.0, 44.42], [26.0, 44.4]];
    expect(findSpikeVertices(detail)).toEqual([]);
  });

  it('is empty for a ring too short to have a middle', () => {
    expect(findSpikeVertices([[26, 44], [26.1, 44]])).toEqual([]);
    expect(findSpikeVertices(null)).toEqual([]);
  });
});

describe('looksLikePlausibleOutline', () => {
  it('accepts a Bucharest outline', () => {
    expect(looksLikePlausibleOutline(square)).toBe(true);
  });

  it('rejects projected coordinates that would otherwise import cleanly', () => {
    // Stereo70 metres parse as valid numbers and produce a polygon somewhere off the map.
    const projected = {
      type: 'Polygon',
      coordinates: [[[589000, 330000], [590000, 330000], [590000, 331000], [589000, 330000]]],
    };
    expect(looksLikePlausibleOutline(projected)).toBe(false);
  });

  it('rejects an empty geometry', () => {
    expect(looksLikePlausibleOutline(null)).toBe(false);
  });
});
