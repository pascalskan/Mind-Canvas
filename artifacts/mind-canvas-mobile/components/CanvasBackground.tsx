import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle, Defs, G, Line, Rect, RadialGradient, Stop, LinearGradient, Text as SvgText,
} from 'react-native-svg';

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface Props {
  camera: Camera;
  screenWidth: number;
  screenHeight: number;
}

const WORLD_SIZE = 7200;
const HALF = WORLD_SIZE / 2;
const MINOR = 40;
const MAJOR = 200;

// Pre-compute grid line positions (world units)
const minorLines: number[] = [];
const majorLines: number[] = [];
for (let i = 0; i <= WORLD_SIZE / MINOR; i++) minorLines.push(-HALF + i * MINOR);
for (let i = 0; i <= WORLD_SIZE / MAJOR; i++) majorLines.push(-HALF + i * MAJOR);

/**
 * SVG canvas background that mirrors the web CoordinateField:
 * - background rect #e9ece9
 * - linear gradient wash
 * - fine grid every 40 world units
 * - major grid every 200 world units
 * - zero axes
 * - central bloom radial gradient
 *
 * The SVG is positioned in screen-space using the camera transform so it
 * scrolls and scales exactly like the bubbles.
 */
export const CanvasBackground = React.memo(function CanvasBackground({
  camera, screenWidth, screenHeight,
}: Props) {
  // The world-space SVG origin (-HALF, -HALF) maps to screen coords:
  //   screenX = worldX * scale + camX
  const svgLeft = -HALF * camera.scale + camera.x;
  const svgTop  = -HALF * camera.scale + camera.y;
  const svgW    = WORLD_SIZE * camera.scale;
  const svgH    = WORLD_SIZE * camera.scale;

  // Only render lines that are visible on screen (culling for performance)
  const toScreen = (w: number) => w * camera.scale;
  const toWorld  = (s: number, origin: number) => (s - origin) / camera.scale;

  const visMinX = toWorld(0, camera.x) - MINOR;
  const visMaxX = toWorld(screenWidth, camera.x) + MINOR;
  const visMinY = toWorld(0, camera.y) - MINOR;
  const visMaxY = toWorld(screenHeight, camera.y) + MINOR;

  const visMinorX = minorLines.filter(v => v >= visMinX && v <= visMaxX);
  const visMinorY = minorLines.filter(v => v >= visMinY && v <= visMaxY);
  const visMajorX = majorLines.filter(v => v >= visMinX && v <= visMaxX);
  const visMajorY = majorLines.filter(v => v >= visMinY && v <= visMaxY);
  const visLabelX = majorLines.filter(v => Math.abs(v) < HALF - 140 && v >= visMinX && v <= visMaxX);
  const visLabelY = majorLines.filter(v => Math.abs(v) < HALF - 140 && v >= visMinY && v <= visMaxY);

  // Minor lines: only draw when camera.scale is large enough to be visible
  const showMinor = camera.scale > 0.04;
  const showLabels = camera.scale > 0.15;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: '#e9ece9' },
      ]}
      pointerEvents="none"
    >
      <Svg
        style={{ position: 'absolute', left: svgLeft, top: svgTop, width: svgW, height: svgH }}
        viewBox={`${-HALF} ${-HALF} ${WORLD_SIZE} ${WORLD_SIZE}`}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="field-wash" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0"   stopColor="#eef0ee" stopOpacity=".95" />
            <Stop offset=".55" stopColor="#f8f8f6" stopOpacity=".68" />
            <Stop offset="1"   stopColor="#e7e9e7" stopOpacity=".92" />
          </LinearGradient>
          <RadialGradient id="field-bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0"   stopColor="#fdfefd" stopOpacity=".85" />
            <Stop offset=".65" stopColor="#f4f5f3" stopOpacity=".16" />
            <Stop offset="1"   stopColor="#e4e7e5" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Background wash */}
        <Rect x={-HALF} y={-HALF} width={WORLD_SIZE} height={WORLD_SIZE} fill="url(#field-wash)" />

        {/* Fine grid — visible only when zoomed in enough */}
        {showMinor && (
          <G stroke="#aab0ad" strokeWidth="1" opacity=".16">
            {visMinorX.map(v => <Line key={`vx${v}`} x1={v} y1={-HALF} x2={v} y2={HALF} />)}
            {visMinorY.map(v => <Line key={`hy${v}`} x1={-HALF} y1={v} x2={HALF} y2={v} />)}
          </G>
        )}

        {/* Major grid */}
        <G stroke="#8c9691" strokeWidth="1.8" opacity=".34">
          {visMajorX.map(v => <Line key={`mx${v}`} x1={v} y1={-HALF} x2={v} y2={HALF} />)}
          {visMajorY.map(v => <Line key={`my${v}`} x1={-HALF} y1={v} x2={HALF} y2={v} />)}
        </G>

        {/* Zero axes */}
        <G stroke="#6e7974" strokeWidth="2.2" opacity=".35">
          <Line x1={0} y1={-HALF} x2={0} y2={HALF} />
          <Line x1={-HALF} y1={0} x2={HALF} y2={0} />
        </G>

        {/* Coordinate labels at major intersections */}
        {showLabels && (
          <G fill="#77817c" opacity=".42" fontSize="18">
            {visLabelX.flatMap(x =>
              visLabelY.map(y => (
                <SvgText key={`lbl-${x}-${y}`} x={x + 10} y={y - 10} fontFamily="monospace">
                  {`${x / MAJOR},${-y / MAJOR}`}
                </SvgText>
              ))
            )}
          </G>
        )}

        {/* Central bloom */}
        <Circle cx="0" cy="0" r="1080" fill="url(#field-bloom)" opacity=".8" />
      </Svg>
    </View>
  );
});
