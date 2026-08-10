import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest for the mobile app's pure logic.
 *
 * Mobile shipped with no test runner at all while the web app had 100+ tests —
 * yet both platforms hold their OWN copy of the layout maths, the persistence
 * validators and the sync rules. Every fix made in two places was verified in
 * one, which is precisely how the two halves drift apart.
 *
 * Scope is deliberately lib/ only: no React Native renderer, no component
 * tests. Standing up a full RN test environment is a much bigger commitment,
 * and the code that actually decides whether a canvas survives a round trip
 * lives in plain TypeScript modules. Those import `react-native` and
 * AsyncStorage for Platform checks and storage, which is what the aliases
 * below replace — the modules under test never touch anything native.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@/': `${path.resolve(__dirname)}/`,
      'react-native': path.resolve(__dirname, 'test/stubs/react-native.ts'),
      '@react-native-async-storage/async-storage': path.resolve(
        __dirname, 'test/stubs/async-storage.ts',
      ),
    },
  },
});
