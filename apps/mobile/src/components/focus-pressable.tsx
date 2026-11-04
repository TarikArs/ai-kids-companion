import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '@/lib/theme';

type State = PressableStateCallbackType & { focused: boolean };

/**
 * Pressable that works with a TV remote (D-pad) and a keyboard: it can take focus, shows a clear yellow ring
 * and grows a little when focused, and OK/Enter presses it. Same API as Pressable; `style` may use `focused`.
 */
export function FocusPressable({
  style,
  onFocus,
  onBlur,
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

  return (
    <Pressable
      ref={ref}
      {...props}
      {...({ hasTVPreferredFocus: preferFocus } as object)}
      disabled={disabled}
      focusable={!disabled}
      onFocus={(e) => {
        setFocused(true);
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
