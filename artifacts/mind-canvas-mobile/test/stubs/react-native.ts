/**
 * Minimal `react-native` stub for the lib/ unit tests.
 *
 * The modules under test import react-native for exactly one thing:
 * `Platform.OS`, used to pick a cloud URL and an export mechanism. Pulling in
 * the real package would drag a whole native runtime into a Node test process
 * to answer a single string, so this provides that string and nothing else.
 *
 * Defaults to 'ios' — the native path, where an app has no `window.location`
 * to fall back on and therefore genuinely needs EXPO_PUBLIC_API_URL. Tests
 * that care about the web build override it via setPlatform().
 */
export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  select<T>(specifics: { ios?: T; android?: T; web?: T; default?: T }): T | undefined {
    return specifics[Platform.OS] ?? specifics.default;
  },
};

/** Lets a test exercise the web-build branch without a second module graph. */
export function setPlatform(os: 'ios' | 'android' | 'web'): void {
  Platform.OS = os;
}
