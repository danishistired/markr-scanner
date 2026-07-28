import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';

// Register PWA Service Worker on Web platform
if (Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[markr PWA] ServiceWorker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.log('[markr PWA] ServiceWorker registration failed:', err);
      });
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
