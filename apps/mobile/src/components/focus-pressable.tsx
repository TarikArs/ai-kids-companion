import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '@/lib/theme';

type State = PressableStateCallbackType & { focused: boolean };

/**
 * When the last touch, click or tap happened. A focus that follows it comes from the finger or the mouse, not from
 * a TV remote or a keyboard: no ring then (like the web's :focus-visible), so a tapped button never stays "active".
 */
let lastPointerAt = 0;
const POINTER_FOCUS_MS = 800;
if (Platform.OS === 'web' && typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pointerdown', () => (lastPointerAt = Date.now()), true);
}
/** The focus that just happened came from a touch or a click (not the TV remote or the keyboard). */
export const fromPointer = () => Date.now() - lastPointerAt < POINTER_FOCUS_MS;

/**
 * Pressable that works with a TV remote (D-pad) and a keyboard: it can take focus, shows a clear yellow ring
 * and grows a little when focused by the remote or the keyboard, and OK/Enter presses it.
 * Touch and mouse never show the ring. Same API as Pressable; `style` may use `focused`.
 */
export function FocusPressable({
  style,
  onFocus,
  onBlur,
  onPressIn,
  focusStyle,
  preferFocus = false,
  disabled,
  ...props
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle> | ((state: State) => StyleProp<ViewStyle>);
  /** Extra style when focused (the ring is always added). */
  focusStyle?: StyleProp<ViewStyle>;
  /** Takes the focus when it appears (first button of a TV screen). */
  preferFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<ComponentRef<typeof Pressable>>(null);

  useEffect(() => {
    if (preferFocus) (ref.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [preferFocus]);

  // A button that becomes disabled (loading) gets no blur event: drop its ring, or it would stay lit.
  useEffect(() => {
    if (disabled) setFocused(false);
  }, [disabled]);

  return (
    <Pressable
      ref={ref}
      {...props}
      {...({ hasTVPreferredFocus: preferFocus } as object)}
      disabled={disabled}
      focusable={!disabled}
      onPressIn={(e) => {
        // Touch on a phone (a TV remote's OK has no touch position).
        if (Platform.OS !== 'web' && !Platform.isTV) lastPointerAt = Date.now();
        onPressIn?.(e);
      }}
      onFocus={(e) => {
        if (!fromPointer()) setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={(state) => [
        typeof style === 'function' ? style({ ...state, focused }) : style,
        focused && ring,
        focused && focusStyle,
      ]}
    />
  );
}

const ring: ViewStyle = {
  outlineWidth: 4,
  outlineColor: colors.accent,
  outlineOffset: 3,
  outlineStyle: 'solid',
  transform: [{ scale: 1.04 }],
};
