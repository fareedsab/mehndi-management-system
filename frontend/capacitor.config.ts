import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mehndi.management',
  appName: 'Mehndi Management',
  webDir: 'dist/frontend/browser',
  server: {
    url: 'https://mehndi-erp.web.app',
    cleartext: true
  }
};

export default config;

