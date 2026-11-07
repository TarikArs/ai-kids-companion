import { Caveat_700Bold } from '@expo-google-fonts/caveat';
import { Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold, useFonts } from '@expo-google-fonts/fredoka';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useAppStore } from '@/lib/store';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hydrated = useAppStore((s) => s.hydrated);
  // Notebook look of the phone screens: Fredoka (rounded, easy to read) and Caveat (notes written by hand).
  const [fontsLoaded, fontError] = useFonts({ Fredoka_400Regular, Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold, Caveat_700Bold });
  const ready = hydrated && (fontsLoaded || !!fontError);
  const reloadKey = useAppStore((s) => s.reloadKey);
  // A new app language remounts every screen (texts are translated while rendering).
  const appLang = useAppStore((s) => s.appLang);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack key={`${reloadKey}-${appLang}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </>
  );
}
