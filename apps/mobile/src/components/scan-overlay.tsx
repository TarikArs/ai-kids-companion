import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

/**
 * « Silia regarde… »: a light band sweeps down and up the photo while it is being read, with corner brackets.
 * Shown over the photo on the Board and the Camera. Still (no sweep) when the device asks for reduced motion.
 */
export function ScanOverlay({ color = '#7FD3FF', corners = true }: { color?: string; corners?: boolean }) {
  const [h, setH] = useState(0);
  const [still, setStill] = useState(false);
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!h || still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [h, still, y]);

  const band = Math.max(40, h * 0.18);
  const onLayout = (e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height);
  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [-band, h] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        {h ? (
          <Animated.View
            style={[
              styles.band,
              { height: band, borderBottomColor: color, shadowColor: color, transform: [{ translateY: still ? h / 2 - band : translateY }] },
            ]}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: 0.12 }]} />
            <View style={[styles.edge, { backgroundColor: color }]} />
          </Animated.View>
        ) : null}
      </View>
      {corners ? (
        <>
          <View style={[styles.corner, { borderColor: color, top: -8, left: -8, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 }]} />
          <View style={[styles.corner, { borderColor: color, top: -8, right: -8, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 }]} />
          <View style={[styles.corner, { borderColor: color, bottom: -8, left: -8, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 }]} />
          <View style={[styles.corner, { borderColor: color, bottom: -8, right: -8, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 }]} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', borderRadius: 6 },
  band: { position: 'absolute', left: 0, right: 0, top: 0, borderBottomWidth: 3, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  edge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, opacity: 0.9 },
  corner: { position: 'absolute', width: 30, height: 30 },
});
