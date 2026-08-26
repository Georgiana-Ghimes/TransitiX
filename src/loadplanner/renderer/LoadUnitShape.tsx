import React, { memo } from 'react';
import type { Box } from '../domain/types';
import { colorForStop, contrastText, type PlannerTheme } from './theme';

export type LoadUnitShapeProps = {
  box: Box;
  /** mm → px scale for each axis of this view. */
  scaleX: number;
  scaleY: number;
  /** Origin of the cargo area in SVG coordinates. */
  originX: number;
  originY: number;
  theme: PlannerTheme;
  selected: boolean;
  invalid: boolean;
  label?: string;
  color?: string;
  onPointerDown?: (event: React.PointerEvent<SVGGElement>, box: Box) => void;
  onSelect?: (box: Box) => void;
  /** Top view maps y→screen-y; side view maps z→screen-y and flips it. */
  screenY: number;
  screenHeight: number;
};

/**
 * One load unit drawn as a rectangle.
 *
 * Memoised on its own props so dragging a single pallet does not repaint the other 499 —
 * the parent passes stable primitives rather than fresh objects per render.
 */
function LoadUnitShapeInner({
  box,
  scaleX,
  originX,
  theme,
  selected,
  invalid,
  label,
  color,
  onPointerDown,
  onSelect,
  screenY,
  screenHeight,
}: LoadUnitShapeProps) {
  const x = originX + box.x * scaleX;
  const width = box.lengthMm * scaleX;

  const fill = invalid
    ? theme.invalid
    : selected
      ? theme.selected
      : color ?? colorForStop(theme, box.stopNumber);
  const stroke = invalid
    ? theme.invalidStroke
    : selected
      ? theme.selectedStroke
      : theme.occupiedStroke;

  const showLabel = width > 26 && screenHeight > 16;

  return (
    <g
      onPointerDown={(event) => onPointerDown?.(event, box)}
      onClick={() => onSelect?.(box)}
      style={{ cursor: onPointerDown ? 'grab' : 'pointer' }}
      data-placement-id={box.id}
    >
      <rect
        x={x}
        y={screenY}
        width={Math.max(1, width)}
        height={Math.max(1, screenHeight)}
        rx={2}
        fill={fill}
        fillOpacity={selected ? 1 : 0.9}
        stroke={stroke}
        strokeWidth={selected ? 2 : 1}
      />
      {showLabel && label && (
        <text
          x={x + width / 2}
          y={screenY + screenHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={contrastText(fill)}
          style={{ fontSize: Math.min(11, screenHeight * 0.45), fontWeight: 600, pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

export const LoadUnitShape = memo(LoadUnitShapeInner);
