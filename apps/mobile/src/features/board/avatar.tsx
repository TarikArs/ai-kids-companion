import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

// Animated cartoon avatar (placeholder until the Rive character exists).
// One animation loop computes a "pose" ~30 times per second; the SVG is drawn from that pose.
// Behaviours: breathing, blinking, glancing, walking, glasses push, wave, hop, peeking at the board,
// thinking (hand on chin), speaking (mouth + nods + hand), praise (jumps + stars), hint/explain (points at the board).

export type AvatarMood = 'idle' | 'thinking' | 'speaking' | 'listening';
export interface AvatarReaction {
  type: 'praise' | 'hint' | 'explain';
  at: number;
}

type Vec = [number, number];
type MouthMode = 'smile' | 'open' | 'o' | 'grin';
type Fidget = 'glasses' | 'wave' | 'hop' | 'peek';

interface Pose {
  x: number;
  bodyY: number;
  tilt: number;
  look: Vec;
  blink: number;
  brow: number;
  mouthMode: MouthMode;
  mouthOpen: number;
  glassesY: number;
  lHand: Vec;
  rHand: Vec;
  pointerAngle: number;
  legL: number;
  legR: number;
  confetti: number; // -1 = none, else 0..1 age
  dots: number; // thinking dots shown (0..3)
  cheeks: number;
}

const SKIN = '#F2C29B';
const HAIR = '#4A2C1D';
const DRESS = '#FFC93C';
const FRAME = '#3A2A5C';
const MOUTH = '#8C2F2F';

const L_SHOULDER: Vec = [172, 378];
const R_SHOULDER: Vec = [328, 378];
const REST_L: Vec = [150, 470];
const REST_R: Vec = [348, 472];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const approach = (cur: number, target: number, k: number) => cur + (target - cur) * k;
const approachVec = (cur: Vec, target: Vec, k: number): Vec => [approach(cur[0], target[0], k), approach(cur[1], target[1], k)];
const bump = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p))); // 0 -> 1 -> 0

const INITIAL: Pose = {
  x: 0,
  bodyY: 0,
  tilt: 0,
  look: [0, 0],
  blink: 0,
  brow: 0,
  mouthMode: 'smile',
  mouthOpen: 0,
  glassesY: 0,
  lHand: REST_L,
  rHand: REST_R,
  pointerAngle: 115,
  legL: 0,
  legR: 0,
  confetti: -1,
  dots: 0,
  cheeks: 0.55,
};

/** Outfit colour per tutor language: the child sees at a glance which language she speaks. */
export const LANGUAGE_OUTFIT: Record<string, string> = {
  fus: '#2E9E6A', // standard Arabic: green
  ar: '#E4572E', // Darija: Moroccan red
  fr: '#3D7FE0', // French: blue
  en: '#FFC93C', // English: sunflower
};

/** Same colour, darker (for the collar). */
function darker(hex: string, k = 0.75): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

export function Avatar({
  mood,
  reaction,
  language = 'fr',
}: {
  mood: AvatarMood;
  reaction?: AvatarReaction | null;
  language?: string;
}) {
  const outfit = LANGUAGE_OUTFIT[language] ?? DRESS;
  const [pose, setPose] = useState<Pose>(INITIAL);
  const moodRef = useRef(mood);
  const reactionRef = useRef<{ type: AvatarReaction['type']; start: number } | null>(null);
  const clockRef = useRef(0);

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  useEffect(() => {
    if (reaction) reactionRef.current = { type: reaction.type, start: clockRef.current };
  }, [reaction]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const startedAt = performance.now();
    const s = {
      pose: { ...INITIAL },
      nextBlink: 1.5,
      blinkStart: -10,
      nextGlance: 1,
      lookTarget: [0, 0] as Vec,
      nextFidget: rand(4, 8),
      fidget: null as { type: Fidget; start: number } | null,
      nextWalk: rand(5, 9),
      walkTarget: 0,
      walkPhase: 0,
    };
    const DUR: Record<Fidget, number> = { glasses: 1.5, wave: 1.9, hop: 0.9, peek: 2.2 };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.033;
      last = now;
      const t = (now - startedAt) / 1000;
      clockRef.current = t;
      const m = moodRef.current;
      const k = 1 - Math.exp(-dt * 9); // smoothing
      const p = s.pose;

      // Reaction from the tutor (praise / hint / explain), with its own duration.
      let r = reactionRef.current;
      const rAge = r ? t - r.start : 0;
      const rDur = r?.type === 'praise' ? 1.8 : r?.type === 'hint' ? 2.8 : 6;
      if (r && rAge > rDur) {
        reactionRef.current = null;
        r = null;
      }
      const rp = r ? rAge / rDur : 0;

      // Blink every 2–5.5 s, sometimes twice.
      if (t > s.nextBlink) {
        s.blinkStart = t;
        s.nextBlink = t + (Math.random() < 0.2 ? 0.3 : rand(2, 5.5));
      }
      const b = (t - s.blinkStart) / 0.16;
      const blink = b >= 0 && b <= 1 ? bump(b) : 0;

      // Glances: where she looks depends on the mood.
      if (t > s.nextGlance) {
        s.nextGlance = t + rand(1.2, 3.5);
        s.lookTarget =
          m === 'thinking'
            ? pick<Vec>([[-6, -7], [6, -7], [-3, -8]])
            : m === 'speaking'
              ? pick<Vec>([[0, 0], [0, 0], [-7, 0]])
              : m === 'listening'
                ? [0, 0]
                : pick<Vec>([[0, 0], [-7, 0], [6, -2], [-4, -6], [-5, 5], [0, 0]]);
      }

      // Idle habits: glasses, wave, hop, peek. Walking a few steps now and then.
      const idle = m === 'idle' && !r;
      if (idle && !s.fidget && t > s.nextFidget) s.fidget = { type: pick<Fidget>(['glasses', 'wave', 'hop', 'peek', 'glasses']), start: t };
      if (s.fidget && (t - s.fidget.start > DUR[s.fidget.type] || !idle)) {
        s.fidget = null;
        s.nextFidget = t + rand(6, 13);
      }
      const f = s.fidget;
      const fp = f ? (t - f.start) / DUR[f.type] : 0;

      if (idle && !f && t > s.nextWalk) {
        s.walkTarget = rand(-38, 38);
        s.nextWalk = t + rand(6, 12);
      }
      if (!idle) s.walkTarget = 0;
      const walking = Math.abs(p.x - s.walkTarget) > 1;
      if (walking) {
        p.x += Math.sign(s.walkTarget - p.x) * Math.min(Math.abs(s.walkTarget - p.x), 45 * dt);
        s.walkPhase += dt * 10;
      }

      // ---- Targets for this frame ----
      let lHand: Vec = REST_L;
      let rHand: Vec = REST_R;
      let pointer = 115;
      let tilt = Math.sin(t * 0.6) * 2.5;
      let look: Vec = s.lookTarget;
      let brow = 0;
      let mouthMode: MouthMode = 'smile';
      let mouthOpen = 0;
      let glassesY = 0;
      let bodyY = Math.sin((t * 2 * Math.PI) / 3.4) * 2.5; // breathing
      let confetti = -1;
      let cheeks = 0.55;

      if (walking) {
        bodyY -= Math.abs(Math.sin(s.walkPhase)) * 3;
        tilt += Math.sin(s.walkPhase) * 2;
      }

      if (m === 'thinking') {
        rHand = [268, 322];
        tilt = -6 + Math.sin(t * 1.5) * 1.5;
        mouthMode = 'o';
        brow = 3;
        glassesY = Math.sin(t * 0.8) > 0.9 ? -3 : 0;
      } else if (m === 'speaking') {
        mouthMode = 'open';
        mouthOpen = 0.2 + 0.7 * Math.abs(Math.sin(t * 13) * Math.sin(t * 3.7 + 1));
        tilt += Math.sin(t * 3.1) * 3;
        brow = Math.max(0, Math.sin(t * 2.3)) * 4;
        lHand = [128 + Math.sin(t * 2.2) * 8, 405 + Math.sin(t * 3.3) * 10]; // talking hand
        pointer = 160;
      } else if (m === 'listening') {
        tilt = 8;
        rHand = [362, 232];
        look = [0, 0];
        brow = 2;
      }

      if (f?.type === 'glasses') {
        const g = bump(fp);
        rHand = [approach(REST_R[0], 300, g), approach(REST_R[1], 214, g)];
        glassesY = fp > 0.35 && fp < 0.7 ? -5 : 0;
        look = [0, 0];
      } else if (f?.type === 'wave') {
        lHand = [104 + Math.sin(t * 12) * 14, 228];
        pointer = -100;
        mouthMode = 'grin';
        look = [0, 0];
      } else if (f?.type === 'hop') {
        bodyY -= bump(fp) * 26;
        mouthMode = 'grin';
      } else if (f?.type === 'peek') {
        look = [-7, 2];
        tilt = -7;
        brow = 3;
      }

      if (r?.type === 'praise') {
        bodyY -= Math.abs(Math.sin(Math.PI * 2 * rp)) * 30 * (1 - rp * 0.4);
        lHand = [122 + Math.sin(t * 14) * 10, 198];
        rHand = [378 - Math.sin(t * 14) * 10, 198];
        pointer = -100;
        mouthMode = 'grin';
        brow = 5;
        cheeks = 0.85;
        confetti = rp;
        look = [0, 0];
      } else if (r?.type === 'hint' || r?.type === 'explain') {
        lHand = [95, 292];
        pointer = -135 + Math.sin(t * (r.type === 'hint' ? 10 : 5)) * 5; // taps the board
        look = m === 'speaking' && Math.sin(t * 0.9) > 0 ? [0, 0] : [-7, -1];
        tilt = -5 + (m === 'speaking' ? Math.sin(t * 3.1) * 2 : 0);
        brow = 3;
      }

      // ---- Smooth towards targets ----
      p.lHand = approachVec(p.lHand, lHand, k);
      p.rHand = approachVec(p.rHand, rHand, k);
      p.pointerAngle = approach(p.pointerAngle, pointer, k);
      p.tilt = approach(p.tilt, tilt, k);
      p.look = approachVec(p.look, look, Math.min(1, k * 1.6));
      p.brow = approach(p.brow, brow, k);
      p.glassesY = approach(p.glassesY, glassesY, Math.min(1, k * 1.5));
      p.cheeks = approach(p.cheeks, cheeks, k);
      p.bodyY = bodyY;
      p.blink = blink;
      p.mouthMode = mouthMode;
      p.mouthOpen = mouthOpen;
      p.legL = walking ? Math.max(0, Math.sin(s.walkPhase)) * 10 : 0;
      p.legR = walking ? Math.max(0, -Math.sin(s.walkPhase)) * 10 : 0;
      p.confetti = confetti;
      p.dots = m === 'thinking' ? Math.floor((t * 2.5) % 4) : 0;

      setPose({ ...p, look: [...p.look] as Vec, lHand: [...p.lHand] as Vec, rHand: [...p.rHand] as Vec });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <View style={{ width: '100%', maxWidth: 340, aspectRatio: 580 / 640 }}>
      <Svg width="100%" height="100%" viewBox="-60 -20 580 640">
        <Ellipse cx={250 + pose.x} cy={590} rx={130 * (1 - Math.min(0.35, -pose.bodyY / 90))} ry={11} fill="#121830" />
        <G transform={`translate(${pose.x}, ${pose.bodyY})`}>
          {/* legs */}
          <G transform={`translate(0, ${-pose.legL})`}>
            <Rect x={212} y={515} width={26} height={56} rx={10} fill={SKIN} />
            <Ellipse cx={222} cy={575} rx={24} ry={11} fill="#FF9F5A" />
          </G>
          <G transform={`translate(0, ${-pose.legR})`}>
            <Rect x={262} y={515} width={26} height={56} rx={10} fill={SKIN} />
            <Ellipse cx={278} cy={575} rx={24} ry={11} fill="#FF9F5A" />
          </G>

          {/* body */}
          <Path d="M150 400 C150 360 190 340 250 340 C310 340 350 360 350 400 L366 528 L134 528 Z" fill={outfit} />
          <Path d="M222 342 L250 372 L278 342" fill="none" stroke={darker(outfit)} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          <Rect x={232} y={300} width={36} height={46} rx={14} fill="#E8B48A" />

          {/* arms (pointer in the left hand) */}
          <Pointer hand={pose.lHand} angle={pose.pointerAngle} />
          <Arm shoulder={L_SHOULDER} hand={pose.lHand} side={1} color={outfit} />
          <Arm shoulder={R_SHOULDER} hand={pose.rHand} side={-1} color={outfit} />

          {/* head */}
          <G transform={`rotate(${pose.tilt} 250 320)`}>
            <Circle cx={250} cy={74} r={50} fill={HAIR} />
            <Circle cx={250} cy={196} r={134} fill={HAIR} />
            <Circle cx={250} cy={208} r={110} fill={SKIN} />
            <Path
              d="M140 196 C140 120 190 92 250 92 C310 92 362 120 360 196 C340 150 300 132 268 150 C250 128 200 128 180 162 C166 172 150 182 140 196 Z"
              fill={HAIR}
            />
            <Circle cx={326} cy={128} r={16} fill="#FF9F5A" />
            <Circle cx={326} cy={128} r={6} fill={outfit} />

            {/* eyes + eyelids */}
            <Ellipse cx={208} cy={214} rx={20} ry={24} fill="#FFFFFF" />
            <Ellipse cx={292} cy={214} rx={20} ry={24} fill="#FFFFFF" />
            <Circle cx={203 + pose.look[0]} cy={218 + pose.look[1]} r={13} fill="#2A1A12" />
            <Circle cx={287 + pose.look[0]} cy={218 + pose.look[1]} r={13} fill="#2A1A12" />
            <Circle cx={199 + pose.look[0]} cy={212 + pose.look[1]} r={4.5} fill="#FFFFFF" />
            <Circle cx={283 + pose.look[0]} cy={212 + pose.look[1]} r={4.5} fill="#FFFFFF" />
            {pose.blink > 0.05 ? (
              <>
                <Rect x={186} y={188} width={44} height={50 * pose.blink} fill={SKIN} />
                <Rect x={270} y={188} width={44} height={50 * pose.blink} fill={SKIN} />
              </>
            ) : null}

            {/* eyebrows */}
            <G transform={`translate(0, ${-pose.brow})`}>
              <Path d="M186 176 C196 168 212 168 222 174" stroke={HAIR} strokeWidth={6} strokeLinecap="round" fill="none" />
              <Path d="M278 174 C288 168 304 168 314 176" stroke={HAIR} strokeWidth={6} strokeLinecap="round" fill="none" />
            </G>

            {/* glasses */}
            <G transform={`translate(0, ${pose.glassesY})`}>
              <Circle cx={208} cy={214} r={31} stroke={FRAME} strokeWidth={6} fill="#FFFFFF" fillOpacity={0.12} />
              <Circle cx={292} cy={214} r={31} stroke={FRAME} strokeWidth={6} fill="#FFFFFF" fillOpacity={0.12} />
              <Path d="M239 210 Q250 200 261 210" stroke={FRAME} strokeWidth={6} fill="none" strokeLinecap="round" />
              <Line x1={177} y1={206} x2={146} y2={198} stroke={FRAME} strokeWidth={5} strokeLinecap="round" />
              <Line x1={323} y1={206} x2={354} y2={198} stroke={FRAME} strokeWidth={5} strokeLinecap="round" />
            </G>

            <Circle cx={174} cy={262} r={16} fill="#F28A8A" opacity={pose.cheeks} />
            <Circle cx={326} cy={262} r={16} fill="#F28A8A" opacity={pose.cheeks} />
            <Mouth mode={pose.mouthMode} open={pose.mouthOpen} />
          </G>
        </G>

        {/* thinking dots */}
        {pose.dots > 0 ? <Circle cx={372 + pose.x} cy={86} r={10} fill="#F4F1E8" /> : null}
        {pose.dots > 1 ? <Circle cx={400 + pose.x} cy={58} r={14} fill="#F4F1E8" /> : null}
        {pose.dots > 2 ? <Circle cx={434 + pose.x} cy={26} r={18} fill="#F4F1E8" /> : null}

        {pose.confetti >= 0 ? <Confetti age={pose.confetti} x={pose.x} /> : null}
      </Svg>
    </View>
  );
}

function Arm({ shoulder, hand, side, color }: { shoulder: Vec; hand: Vec; side: 1 | -1; color: string }) {
  const [sx, sy] = shoulder;
  const [hx, hy] = hand;
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.max(10, 70 - len / 3); // shorter reach = more bent elbow
  const ex = (sx + hx) / 2 + (-dy / len) * bend * side;
  const ey = (sy + hy) / 2 + (dx / len) * bend * side;
  return (
    <>
      <Path d={`M${sx} ${sy} Q${ex} ${ey} ${hx} ${hy}`} stroke={color} strokeWidth={36} strokeLinecap="round" fill="none" />
      <Circle cx={hx} cy={hy} r={19} fill={SKIN} />
    </>
  );
}

function Pointer({ hand, angle }: { hand: Vec; angle: number }) {
  const a = (angle * Math.PI) / 180;
  const tx = hand[0] + Math.cos(a) * 105;
  const ty = hand[1] + Math.sin(a) * 105;
  return (
    <>
      <Line x1={hand[0]} y1={hand[1]} x2={tx} y2={ty} stroke="#8A5A33" strokeWidth={9} strokeLinecap="round" />
      <Circle cx={tx} cy={ty} r={8} fill="#F4F1E8" />
    </>
  );
}

function Mouth({ mode, open }: { mode: MouthMode; open: number }) {
  if (mode === 'grin') {
    return (
      <>
        <Path d="M218 258 C230 302 270 302 282 258 Z" fill={MOUTH} />
        <Path d="M224 260 L276 260 L271 271 L229 271 Z" fill="#FFFFFF" />
      </>
    );
  }
  if (mode === 'o') return <Ellipse cx={262} cy={272} rx={7} ry={8} fill={MOUTH} />;
  if (mode === 'open' && open > 0.08) {
    const d = 260 + 40 * open;
    return (
      <>
        <Path d={`M226 260 C232 ${d} 268 ${d} 274 260 Z`} fill={MOUTH} />
        {open > 0.35 ? <Ellipse cx={250} cy={260 + 24 * open} rx={11} ry={5 * open} fill="#F07E7E" /> : null}
      </>
    );
  }
  return <Path d="M222 262 C236 284 264 284 278 262" stroke={MOUTH} strokeWidth={6} strokeLinecap="round" fill="none" />;
}

const CONFETTI_COLORS = ['#FFC93C', '#5BD68A', '#FF9F5A', '#7FD3FF', '#F28AC0', '#F4F1E8'];

function Confetti({ age, x }: { age: number; x: number }) {
  const items = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    const radius = 130 + 110 * age;
    return {
      cx: 250 + x + Math.cos(angle) * radius,
      cy: 170 + Math.sin(angle) * radius * 0.7 - 60 * age,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 7 + (i % 3) * 3,
    };
  });
  return (
    <>
      {items.map((c, i) => (
        <Rect
          key={i}
          x={c.cx - c.size / 2}
          y={c.cy - c.size / 2}
          width={c.size}
          height={c.size}
          rx={i % 2 ? c.size / 2 : 2}
          fill={c.color}
          opacity={1 - age}
          transform={`rotate(${age * 360 + i * 30} ${c.cx} ${c.cy})`}
        />
      ))}
    </>
  );
}
