import type { Annotation } from '@hc/shared';
import { useState } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

interface Props {
  uri: string;
  width: number;
  height: number;
  annotations: Annotation[];
  /** Degrees clockwise to show the page upright (phone lying flat). Marks turn with the photo. */
  rotation?: number;
}

/** Notebook photo fitted in its box, with chalk marks drawn over the child's answers. */
export function AnnotatedPhoto({ uri, width, height, annotations, rotation = 0 }: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // Turned a quarter: the photo's width runs vertically on screen.
  const sideways = rotation === 90 || rotation === 270;
  const scale = box.w && box.h ? (sideways ? Math.min(box.w / height, box.h / width) : Math.min(box.w / width, box.h / height)) : 0;
  const W = width * scale;
  const H = height * scale;

  return (
    <View style={styles.box} onLayout={onLayout}>
      {scale > 0 ? (
        <View style={{ width: W, height: H, transform: [{ rotate: `${rotation - 0.8}deg` }] }}>
          <Image source={{ uri }} style={{ width: W, height: H, borderRadius: 6 }} resizeMode="stretch" />
          <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
            {annotations.map((a, i) => (
              <Mark key={i} a={a} W={W} H={H} />
            ))}
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

function Mark({ a, W, H }: { a: Annotation; W: number; H: number }) {
  const x = a.region.x * W;
  const y = a.region.y * H;
  const w = a.region.w * W;
  const h = a.region.h * H;
  const color = a.color ?? '#FF9F5A';

  switch (a.shape) {
    case 'circle':
      return (
        <Ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={Math.max(w * 0.75, 26)}
          ry={Math.max(h * 0.9, 22)}
          stroke={color}
          strokeWidth={5}
          fill="none"
        />
      );
    case 'tick': {
      const s = Math.max(h, 26);
      const l = x + w + 6;
      const t = y + h / 2 - s / 2;
      return (
        <Path
          d={`M${l} ${t + s * 0.55} L${l + s * 0.35} ${t + s * 0.9} L${l + s} ${t + s * 0.1}`}
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    }
    case 'text': {
      // Numbered badge on an exercise ("1", "2"…), with a soft frame around the exercise.
      const r = Math.max(18, Math.min(28, W * 0.035));
      return (
        <>
          <Rect x={x} y={y} width={w} height={h} rx={10} stroke={color} strokeWidth={3} strokeDasharray="10 8" fill={color} fillOpacity={0.08} />
          <Circle cx={x + r * 0.6} cy={y + r * 0.6} r={r} fill={color} />
          <SvgText x={x + r * 0.6} y={y + r * 0.6 + r * 0.38} fontSize={r * 1.1} fontWeight="900" fill="#1B2340" textAnchor="middle">
            {a.text ?? ''}
          </SvgText>
        </>
      );
    }
    case 'cross':
      return (
        <>
          <Line x1={x} y1={y} x2={x + w} y2={y + h} stroke={color} strokeWidth={5} strokeLinecap="round" />
          <Line x1={x + w} y1={y} x2={x} y2={y + h} stroke={color} strokeWidth={5} strokeLinecap="round" />
        </>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
