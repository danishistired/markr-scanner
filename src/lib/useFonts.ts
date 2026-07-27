import { useFonts as useExpoFonts } from 'expo-font';
import { DotGothic16_400Regular } from '@expo-google-fonts/dotgothic16';

/**
 * Loads the DotGothic16 font (Nothing OS pixel/LCD aesthetic).
 * Returns loading state so the app can hold on the splash screen.
 */
export function useFonts() {
  const [fontsLoaded, fontError] = useExpoFonts({
    DotGothic16: DotGothic16_400Regular,
  });

  return { fontsLoaded, fontError };
}
