import React from 'react';
import { useWindowDimensions } from 'react-native';
import Svg, {
  Circle, Defs, Line, Rect, RadialGradient, Stop, Pattern,
} from 'react-native-svg';

interface Camera { x: number; y: number; scale: number }
interface Props   { camera: Camera }

/**
 * Screen-space canvas background that matches the web CoordinateField.
 *
 * Uses SVG <Pattern> tiles so the GPU handles tiling — no per-frame JS
 * array allocation, fixed element count at every zoom level.
 *
 * The pattern offset is computed from (camX % spacing, camY % spacing) so
 * grid lines always align with world-space grid points.
 */
export const CanvasBackground = React.memo(function CanvasBackground({ camera }: Props) {
  // useWindowDimensions, not a module-level Dimensions.get() snapshot — this
  // component is memoized on `camera` alone, so a stale module constant would
  // never have been corrected even by an unrelated re-render elsewhere; the
  // background would just stay sized for whatever the viewport was at first
  // mount, indefinitely, after any rotation or (react-native-web) resize.
  const { width: SW, height: SH } = useWindowDimensions();
  const { x: camX, y: camY, scale } = camera;

  // Screen-space spacing between grid lines
  const fineSpacing  = 40  * scale;   // 40  world units in screen px
  const majorSpacing = 200 * scale;   // 200 world units in screen px

  // Pattern offsets — keeps lines anchored to world origin as camera moves.
  // The extra +spacing handles negative camX/camY (modulo can return negative
  // numbers in JS).
  const fineOffX  = ((camX % fineSpacing)  + fineSpacing)  % fineSpacing;
  const fineOffY  = ((camY % fineSpacing)  + fineSpacing)  % fineSpacing;
  const majorOffX = ((camX % majorSpacing) + majorSpacing) % majorSpacing;
  const majorOffY = ((camY % majorSpacing) + majorSpacing) % majorSpacing;

  // Only show fine grid when cells are large enough to distinguish (> 10 px)
  const showFine = fineSpacing > 10;

  // Bloom follows world origin
  const bloomR = 1080 * scale;

  return (
    <Svg
      width={SW} height={SH}
      style={{ position: 'absolute', top: 0, left: 0 }}
      pointerEvents="none"
    >
      <Defs>
        {/* Fine grid tile — one vertical + one horizontal edge line per cell */}
        {showFine && (
          <Pattern
            id="fine"
            x={fineOffX} y={fineOffY}
            width={fineSpacing} height={fineSpacing}
            patternUnits="userSpaceOnUse"
          >
            <Line
              x1={fineSpacing} y1={0}
              x2={fineSpacing} y2={fineSpacing}
              stroke="#aab0ad" strokeWidth={0.8} opacity={0.55}
            />
            <Line
              x1={0} y1={fineSpacing}
              x2={fineSpacing} y2={fineSpacing}
              stroke="#aab0ad" strokeWidth={0.8} opacity={0.55}
            />
          </Pattern>
        )}

        {/* Major grid tile */}
        <Pattern
          id="major"
          x={majorOffX} y={majorOffY}
          width={majorSpacing} height={majorSpacing}
          patternUnits="userSpaceOnUse"
        >
          <Line
            x1={majorSpacing} y1={0}
            x2={majorSpacing} y2={majorSpacing}
            stroke="#8c9691" strokeWidth={1.5} opacity={0.55}
          />
          <Line
            x1={0} y1={majorSpacing}
            x2={majorSpacing} y2={majorSpacing}
            stroke="#8c9691" strokeWidth={1.5} opacity={0.55}
          />
        </Pattern>

        {/* Central bloom */}
        <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
          <Stop offset="0%"   stopColor="#fdfefd" stopOpacity={0.85} />
          <Stop offset="65%"  stopColor="#f4f5f3" stopOpacity={0.16} />
          <Stop offset="100%" stopColor="#e4e7e5" stopOpacity={0}    />
        </RadialGradient>
      </Defs>

      {/* Background fill */}
      <Rect x={0} y={0} width={SW} height={SH} fill="#e9ece9" />

      {/* Fine grid */}
      {showFine && (
        <Rect x={0} y={0} width={SW} height={SH} fill="url(#fine)" />
      )}

      {/* Major grid */}
      <Rect x={0} y={0} width={SW} height={SH} fill="url(#major)" />

      {/* Zero axes (always 2 lines) */}
      <Line x1={camX} y1={0} x2={camX} y2={SH}
        stroke="#6e7974" strokeWidth={2} opacity={0.35} />
      <Line x1={0} y1={camY} x2={SW}   y2={camY}
        stroke="#6e7974" strokeWidth={2} opacity={0.35} />

      {/* Central bloom centred on world origin */}
      <Circle cx={camX} cy={camY} r={bloomR} fill="url(#bloom)" opacity={0.8} />
    </Svg>
  );
});
