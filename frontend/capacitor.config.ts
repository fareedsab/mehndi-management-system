import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mehndi.management',
  appName: 'Mehndi Management',
  webDir: 'dist/frontend/browser',
  server: {
    url: 'https://saw-professional-warren-reductions.trycloudflare.com',
    cleartext: true
  }
};

export default config;

