import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Simple stroke icons (24x24) drawn with react-native-svg: no extra package.

export type IconName = 'mic' | 'stop' | 'pause' | 'play' | 'flag' | 'unlink' | 'info' | 'home' | 'keyboard' | 'send' | 'eye' | 'copy' | 'speaker' | 'expand' | 'refresh' | 'check';

export function Icon({ name, size = 28, color = '#FFFFFF' }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'mic' ? (
        <>
          <Rect x={9} y={2} width={6} height={12} rx={3} {...p} />
          <Path d="M5 10a7 7 0 0 0 14 0" {...p} />
          <Line x1={12} y1={17} x2={12} y2={22} {...p} />
        </>
      ) : null}
      {name === 'stop' ? <Rect x={6} y={6} width={12} height={12} rx={2} fill={color} /> : null}
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
      {name === 'keyboard' ? (
        <>
          <Rect x={2} y={6} width={20} height={12} rx={2} {...p} />
          <Line x1={6} y1={10} x2={6.01} y2={10} {...p} />
          <Line x1={10} y1={10} x2={10.01} y2={10} {...p} />
          <Line x1={14} y1={10} x2={14.01} y2={10} {...p} />
          <Line x1={18} y1={10} x2={18.01} y2={10} {...p} />
          <Line x1={8} y1={14} x2={16} y2={14} {...p} />
        </>
      ) : null}
      {name === 'send' ? (
        <>
          <Path d="M22 2L11 13" {...p} />
          <Path d="M22 2l-7 20-4-9-9-4z" {...p} />
        </>
      ) : null}
      {name === 'eye' ? (
        <>
          <Path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" {...p} />
          <Circle cx={12} cy={12} r={3.5} {...p} />
        </>
      ) : null}
      {name === 'copy' ? (
        <>
          <Rect x={3} y={7} width={12} height={14} rx={2} {...p} />
          <Path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" {...p} />
        </>
      ) : null}
      {name === 'speaker' ? (
        <>
          <Path d="M4 10v4h4l5 4V6L8 10z" {...p} />
          <Path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" {...p} />
        </>
      ) : null}
      {name === 'expand' ? <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...p} /> : null}
      {name === 'refresh' ? (
        <>
          <Path d="M20 11a8 8 0 1 0-2.3 5.7" {...p} />
          <Path d="M20 4v7h-7" {...p} />
        </>
      ) : null}
      {name === 'check' ? <Path d="M4 12.5l5 5L20 6.5" {...p} strokeWidth={2.6} /> : null}
      {name === 'home' ? (
        <>
          <Path d="M3 11l9-8 9 8" {...p} />
          <Path d="M5 10v10h14V10" {...p} />
          <Path d="M10 20v-6h4v6" {...p} />
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
