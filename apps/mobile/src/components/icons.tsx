import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Simple stroke icons (24x24) drawn with react-native-svg: no extra package.

export type IconName = 'camera' | 'mic' | 'stop' | 'bulb' | 'pause' | 'play' | 'flag' | 'unlink' | 'info' | 'check';

export function Icon({ name, size = 28, color = '#FFFFFF' }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'camera' ? (
        <>
          <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p} />
          <Circle cx={12} cy={13} r={4} {...p} />
        </>
      ) : null}
      {name === 'mic' ? (
        <>
          <Rect x={9} y={2} width={6} height={12} rx={3} {...p} />
          <Path d="M5 10a7 7 0 0 0 14 0" {...p} />
          <Line x1={12} y1={17} x2={12} y2={22} {...p} />
        </>
      ) : null}
      {name === 'check' ? <Path d="M4 12.5l5 5L20 6.5" {...p} strokeWidth={2.6} /> : null}
      {name === 'stop' ? <Rect x={6} y={6} width={12} height={12} rx={2} fill={color} /> : null}
      {name === 'bulb' ? (
        <>
          <Path d="M9 18h6" {...p} />
          <Path d="M10 22h4" {...p} />
          <Path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" {...p} />
        </>
      ) : null}
      {name === 'pause' ? (
        <>
          <Line x1={9} y1={5} x2={9} y2={19} {...p} />
          <Line x1={15} y1={5} x2={15} y2={19} {...p} />
        </>
      ) : null}
      {name === 'play' ? <Path d="M7 4l13 8-13 8z" fill={color} /> : null}
      {name === 'flag' ? (
        <>
          <Path d="M4 22V4" {...p} />
          <Path d="M4 4h13l-2 4 2 4H4" {...p} />
        </>
      ) : null}
      {name === 'unlink' ? (
        <>
          <Path d="M9 17H7A5 5 0 0 1 7 7h2" {...p} />
          <Path d="M15 7h2a5 5 0 0 1 4 8" {...p} />
          <Line x1={8} y1={12} x2={11} y2={12} {...p} />
          <Line x1={2} y1={2} x2={22} y2={22} {...p} />
        </>
      ) : null}
      {name === 'info' ? (
        <>
          <Circle cx={12} cy={12} r={10} {...p} />
          <Line x1={12} y1={16} x2={12} y2={12} {...p} />
          <Line x1={12} y1={8} x2={12.01} y2={8} {...p} />
        </>
      ) : null}
    </Svg>
  );
}
