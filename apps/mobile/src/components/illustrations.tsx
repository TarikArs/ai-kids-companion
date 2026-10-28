import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

// Small flat illustrations for the three device types (react-native-svg, no image files).

export type ArtName = 'board' | 'camera' | 'parent';

const INK = '#1B2340';
const CHALK = '#1F4A3D';
const WOOD = '#A06A3F';
const SUN = '#FFC93C';
const SKY = '#7FD3FF';
const SKIN = '#F4C7A1';
const PAPER = '#FFFDF6';

export function RoleArt({ name, size = 96 }: { name: ArtName; size?: number }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 120 96">
      {name === 'board' ? <BoardArt /> : name === 'camera' ? <CameraArt /> : <ParentArt />}
    </Svg>
  );
}

/** TV with a chalkboard and a friendly teacher. */
function BoardArt() {
  return (
    <G>
      <Ellipse cx={60} cy={88} rx={44} ry={5} fill="#000" opacity={0.18} />
      <Rect x={14} y={10} width={92} height={62} rx={10} fill={WOOD} />
      <Rect x={20} y={16} width={80} height={50} rx={6} fill={CHALK} />
      <Path d="M28 30 h18 M37 21 v18" stroke="#F4F1E8" strokeWidth={3} strokeLinecap="round" />
      <Path d="M52 30 h12" stroke="#F4F1E8" strokeWidth={3} strokeLinecap="round" />
      <Path d="M30 50 q8 -8 16 0 t16 0" stroke={SUN} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Rect x={52} y={72} width={16} height={8} fill={WOOD} />
      <Rect x={40} y={80} width={40} height={5} rx={2.5} fill={WOOD} />
      {/* teacher */}
      <Circle cx={84} cy={46} r={13} fill={SKIN} />
      <Path d="M71 44 q2 -15 13 -15 q12 0 14 15 q-5 -7 -14 -7 q-8 0 -13 7z" fill={SUN} />
      <Circle cx={95} cy={33} r={5} fill={SUN} />
      <Circle cx={80} cy={47} r={1.6} fill={INK} />
      <Circle cx={88} cy={47} r={1.6} fill={INK} />
      <Path d="M80 52 q4 3.5 8 0" stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Path d="M71 66 q13 -14 26 0z" fill={SKY} />
    </G>
  );
}

/** Phone above an open notebook. */
function CameraArt() {
  return (
    <G>
      <Ellipse cx={60} cy={88} rx={46} ry={5} fill="#000" opacity={0.18} />
      {/* notebook */}
      <Path d="M14 58 L58 50 L58 84 L14 90z" fill={PAPER} />
      <Path d="M62 50 L106 58 L106 90 L62 84z" fill={PAPER} />
      <Path d="M58 50 q2 -2 4 0 v34 q-2 -2 -4 0z" fill="#D9D3C2" />
      {[0, 1, 2].map((i) => (
        <G key={i}>
          <Line x1={20} y1={65 + i * 7} x2={52} y2={60 + i * 7} stroke={SKY} strokeWidth={1.5} />
          <Line x1={68} y1={60 + i * 7} x2={100} y2={65 + i * 7} stroke={SKY} strokeWidth={1.5} />
        </G>
      ))}
      <Path d="M24 66 l3 3 l6 -7" stroke="#5BD68A" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      {/* phone */}
      <Rect x={44} y={4} width={32} height={50} rx={7} fill={INK} />
      <Rect x={47} y={9} width={26} height={38} rx={4} fill="#3A4678" />
      <Circle cx={60} cy={28} r={8} fill={INK} />
      <Circle cx={60} cy={28} r={5} fill={SKY} />
      <Circle cx={58} cy={26} r={1.5} fill="#FFFFFF" />
      {/* flash rays */}
      <Path d="M84 12 l8 -5 M86 22 h9 M84 32 l8 5" stroke={SUN} strokeWidth={3} strokeLinecap="round" />
    </G>
  );
}

/** Parent and child with a heart. */
function ParentArt() {
  return (
    <G>
      <Ellipse cx={60} cy={88} rx={42} ry={5} fill="#000" opacity={0.18} />
      {/* parent */}
      <Path d="M22 86 q0 -30 22 -30 q22 0 22 30z" fill={SKY} />
      <Circle cx={44} cy={38} r={14} fill={SKIN} />
      <Path d="M30 36 q2 -16 14 -16 q13 0 14 16 q-6 -8 -14 -8 q-8 0 -14 8z" fill="#6B4430" />
      <Circle cx={39.5} cy={39} r={1.7} fill={INK} />
      <Circle cx={48.5} cy={39} r={1.7} fill={INK} />
      <Path d="M40 45 q4 3 8 0" stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      {/* child */}
      <Path d="M64 86 q0 -20 16 -20 q16 0 16 20z" fill={SUN} />
      <Circle cx={80} cy={54} r={11} fill={SKIN} />
      <Path d="M69 52 q1 -12 11 -12 q10 0 11 12 q-5 -6 -11 -6 q-6 0 -11 6z" fill={WOOD} />
      <Circle cx={92} cy={46} r={4} fill={WOOD} />
      <Circle cx={76.5} cy={55} r={1.5} fill={INK} />
      <Circle cx={83.5} cy={55} r={1.5} fill={INK} />
      <Path d="M77 60 q3 2.5 6 0" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      {/* heart */}
      <Path d="M66 22 c-4 -6 -12 -2 -9 4 l9 9 l9 -9 c3 -6 -5 -10 -9 -4z" fill="#FF8A80" />
    </G>
  );
}
