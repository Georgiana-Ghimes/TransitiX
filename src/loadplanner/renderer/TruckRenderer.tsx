import React, { useCallback, useMemo, useRef } from 'react';
import { cargoSections, vehicleSpanMm } from '../domain/geometry';
import type { Box, CargoSection, Millimetres, VehicleTemplate } from '../domain/types';
import { LoadUnitShape } from './LoadUnitShape';
import { DEFAULT_THEME, type PlannerTheme } from './theme';

export type ViewMode = 'top' | 'side';

export type DragPayload = {
  boxId: string;
  /** Grab offset inside the box, in mm, so it does not jump to the cursor. */
  offsetXMm: Millimetres;
  offsetAcrossMm: Millimetres;
};

export type TruckRendererProps = {
  vehicle: VehicleTemplate;
  boxes: Box[];
  view: ViewMode;
  theme?: PlannerTheme;
  selectedId?: string | null;
  invalidIds?: ReadonlySet<string>;
  labelFor?: (box: Box) => string | undefined;
  colorFor?: (box: Box) => string | undefined;
  onSelect?: (box: Box | null) => void;
  /** Called continuously while dragging, with the proposed position in mm. */
  onDragMove?: (boxId: string, xMm: Millimetres, acrossMm: Millimetres) => void;
  onDragEnd?: (boxId: string) => void;
  /** External drop (from the load list) — cursor position in mm. */
  onExternalDrop?: (xMm: Millimetres, acrossMm: Millimetres, sectionId: string) => void;
  height?: number;
};

/** Millimetres of padding drawn around the vehicle so nothing touches the viewport edge. */
const PAD_MM = 600;

/**
 * Parametric 2D vehicle renderer.
 *
 * Every shape is derived from the template geometry — there is no per-model artwork. Top and
 * side views share this component and differ only in which axis maps to screen-y, which is
 * what keeps the two views guaranteed consistent.
 */
export function TruckRenderer({
  vehicle,
  boxes,
  view,
  theme = DEFAULT_THEME,
  selectedId = null,
  invalidIds,
  labelFor,
  colorFor,
  onSelect,
  onDragMove,
  onDragEnd,
  onExternalDrop,
  height = 260,
}: TruckRendererProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragPayload | null>(null);

  const sections = useMemo(() => cargoSections(vehicle), [vehicle]);
  const spanMm = useMemo(() => vehicleSpanMm(vehicle), [vehicle]);

  // Include the cab and any axle ahead of the cargo in the drawn extent.
  const minXMm = useMemo(
    () => Math.min(0, ...vehicle.axles.map((a) => a.positionMm)) - PAD_MM,
    [vehicle]
  );
  const maxXMm = spanMm + PAD_MM;
  const totalWidthMm = maxXMm - minXMm;

  const acrossMm = useMemo(() => {
    if (view === 'top') return Math.max(...sections.map((s) => s.cargo.widthMm));
    return Math.max(...sections.map((s) => s.cargo.heightMm));
  }, [sections, view]);

  const viewWidth = 1000;
  const scale = viewWidth / totalWidthMm;
  const acrossPx = acrossMm * scale;
  const topPad = 34;
  const viewHeight = acrossPx + topPad + 46;

  const originX = -minXMm * scale;
  const cargoTop = topPad;

  /** SVG point → millimetres in vehicle space. */
  const toMm = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * viewWidth;
    const py = ((clientY - rect.top) / rect.height) * viewHeight;
    const xMm = px / scale + minXMm;
    const acrossValue = view === 'top'
      ? (py - cargoTop) / scale
      : acrossMm - (py - cargoTop) / scale;
    return { xMm, acrossMm: acrossValue };
  }, [scale, minXMm, view, acrossMm, cargoTop, viewHeight]);

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGGElement>, box: Box) => {
    if (!onDragMove) return;
    event.stopPropagation();
    const point = toMm(event.clientX, event.clientY);
    if (!point) return;
    const across = view === 'top' ? box.y : box.z;
    dragRef.current = {
      boxId: box.id,
      offsetXMm: point.xMm - box.x,
      offsetAcrossMm: point.acrossMm - across,
    };
    (event.currentTarget as unknown as Element).setPointerCapture?.(event.pointerId);
    onSelect?.(box);
  }, [onDragMove, onSelect, toMm, view]);

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !onDragMove) return;
    const point = toMm(event.clientX, event.clientY);
    if (!point) return;
    onDragMove(drag.boxId, point.xMm - drag.offsetXMm, point.acrossMm - drag.offsetAcrossMm);
  }, [onDragMove, toMm]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) onDragEnd?.(drag.boxId);
  }, [onDragEnd]);

  const handleDrop = useCallback((event: React.DragEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (!onExternalDrop) return;
    const point = toMm(event.clientX, event.clientY);
    if (!point) return;
    const section = sections.find((s) => point.xMm >= s.offsetMm
      && point.xMm <= s.offsetMm + s.cargo.lengthMm) ?? sections[0];
    onExternalDrop(point.xMm - section.offsetMm, point.acrossMm, section.id);
  }, [onExternalDrop, sections, toMm]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      style={{ width: '100%', height, touchAction: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClick={(event) => { if (event.target === svgRef.current) onSelect?.(null); }}
      onDragOver={(event) => { if (onExternalDrop) event.preventDefault(); }}
      onDrop={handleDrop}
      role="img"
      aria-label={`${vehicle.name} — vedere ${view === 'top' ? 'de sus' : 'laterală'}`}
    >
      <VehicleChrome
        vehicle={vehicle}
        sections={sections}
        view={view}
        theme={theme}
        scale={scale}
        originX={originX}
        cargoTop={cargoTop}
        acrossMm={acrossMm}
        viewHeight={viewHeight}
      />

      {boxes.map((box) => {
        const section = sections.find((s) => box.x >= s.offsetMm - 1
          && box.x < s.offsetMm + s.cargo.lengthMm + 1) ?? sections[0];
        const across = view === 'top' ? box.y : box.z;
        const extent = view === 'top' ? box.widthMm : box.heightMm;
        const screenY = view === 'top'
          ? cargoTop + across * scale
          : cargoTop + (acrossMm - across - extent) * scale;
        return (
          <LoadUnitShape
            key={box.id}
            box={{ ...box, x: box.x + section.offsetMm }}
            scaleX={scale}
            scaleY={scale}
            originX={originX}
            originY={cargoTop}
            theme={theme}
            selected={selectedId === box.id}
            invalid={Boolean(invalidIds?.has(box.id))}
            label={labelFor?.(box)}
            color={colorFor?.(box)}
            onPointerDown={handlePointerDown}
            onSelect={(b) => onSelect?.(b)}
            screenY={screenY}
            screenHeight={extent * scale}
          />
        );
      })}
    </svg>
  );
}

type ChromeProps = {
  vehicle: VehicleTemplate;
  sections: CargoSection[];
  view: ViewMode;
  theme: PlannerTheme;
  scale: number;
  originX: number;
  cargoTop: number;
  acrossMm: number;
  viewHeight: number;
};

/** Cab, body outline, doors, axles and wheels — all derived from the template. */
function VehicleChrome({
  vehicle, sections, view, theme, scale, originX, cargoTop, acrossMm, viewHeight,
}: ChromeProps) {
  const groundY = cargoTop + acrossMm * scale;
  const isSide = view === 'side';

  return (
    <g>
      {isSide && (
        <line x1={0} y1={groundY} x2={1000} y2={groundY} stroke={theme.axis} strokeWidth={1.5} />
      )}

      {isSide && vehicle.visualization.cabStyle !== 'none' && (
        <Cab
          style={vehicle.visualization.cabStyle}
          theme={theme}
          scale={scale}
          originX={originX}
          groundY={groundY}
        />
      )}

      {sections.map((section) => {
        const x = originX + section.offsetMm * scale;
        const width = section.cargo.lengthMm * scale;
        const across = isSide ? section.cargo.heightMm : section.cargo.widthMm;
        const y = isSide ? groundY - across * scale : cargoTop;
        const heightPx = across * scale;

        return (
          <g key={section.id}>
            <rect
              x={x} y={y} width={width} height={heightPx}
              fill={theme.free} stroke={theme.wall} strokeWidth={2} rx={3}
            />
            <GridLines
              x={x} y={y} width={width} height={heightPx}
              stepPx={1000 * scale} theme={theme}
            />
            {/* Doors sit at the rear of each section. */}
            <line
              x1={x + width} y1={y + 3} x2={x + width} y2={y + heightPx - 3}
              stroke={theme.selected} strokeWidth={3} strokeLinecap="round"
            />
            <text
              x={x + width - 4} y={y - 6} textAnchor="end"
              fill={theme.textMuted} style={{ fontSize: 10 }}
            >
              uși
            </text>
            {sections.length > 1 && (
              <text x={x + 4} y={y - 6} fill={theme.textMuted} style={{ fontSize: 10 }}>
                {section.label}
              </text>
            )}
          </g>
        );
      })}

      {isSide && (vehicle.visualization.wheelPositionsMm ?? []).map((posMm, i) => (
        <g key={`${posMm}-${i}`}>
          <circle cx={originX + posMm * scale} cy={groundY} r={11} fill={theme.chassis} />
          <circle cx={originX + posMm * scale} cy={groundY} r={4} fill={theme.axis} />
        </g>
      ))}

      {isSide && vehicle.axles.map((axle) => (
        <text
          key={axle.id}
          x={originX + axle.positionMm * scale}
          y={viewHeight - 6}
          textAnchor="middle"
          fill={theme.textMuted}
          style={{ fontSize: 9 }}
        >
          {axle.label}
        </text>
      ))}
    </g>
  );
}

function Cab({
  style, theme, scale, originX, groundY,
}: { style: string; theme: PlannerTheme; scale: number; originX: number; groundY: number }) {
  const heightMm = style === 'van' ? 1900 : style === 'tractor' ? 3200 : 2600;
  const lengthMm = style === 'van' ? 1500 : style === 'tractor' ? 2300 : 2000;
  const h = heightMm * scale;
  const w = lengthMm * scale;
  const x = originX - w - 4;
  const y = groundY - h;

  return (
    <g>
      <path
        d={`M${x} ${groundY} L${x} ${y + h * 0.18} Q${x} ${y} ${x + w * 0.18} ${y} L${x + w} ${y} L${x + w} ${groundY} Z`}
        fill={theme.cab}
        stroke={theme.cab}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <rect
        x={x + w * 0.12} y={y + h * 0.12}
        width={w * 0.62} height={h * 0.3}
        fill={theme.cabGlass} opacity={0.85} rx={2}
      />
    </g>
  );
}

function GridLines({
  x, y, width, height, stepPx, theme,
}: { x: number; y: number; width: number; height: number; stepPx: number; theme: PlannerTheme }) {
  if (stepPx < 6) return null;
  const lines: React.ReactNode[] = [];
  for (let offset = stepPx; offset < width; offset += stepPx) {
    lines.push(
      <line
        key={offset}
        x1={x + offset} y1={y + 2} x2={x + offset} y2={y + height - 2}
        stroke={theme.grid} strokeWidth={1}
      />
    );
  }
  return <g>{lines}</g>;
}
