import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.findex.files',
  appName: 'Findex',
  webDir: 'dist',
  backgroundColor: '#f4f6f1',
  loggingBehavior: 'none',
  android: {
    backgroundColor: '#f4f6f1',
    allowMixedContent: false,
    loggingBehavior: 'none',
    webContentsDebuggingEnabled: false,
  },
};
export default config;
