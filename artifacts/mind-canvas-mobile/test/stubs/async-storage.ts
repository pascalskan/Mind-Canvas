/**
 * In-memory AsyncStorage stub for the lib/ unit tests.
 *
 * Matches the subset of the real API that persistence.ts uses, with the same
 * promise semantics (getItem resolves null for a missing key). `failNextWrite`
 * exists because the interesting case is the one production hits and tests
 * usually skip: a write that FAILS. saveBubbles returning false is what tells
 * the app a draft was not persisted, and that path needs coverage.
 */
const store = new Map<string, string>();
let failWrites = false;

export function __reset(): void {
  store.clear();
  failWrites = false;
}

/** Makes every subsequent setItem reject, as a full or unavailable store would. */
export function __setFailWrites(fail: boolean): void {
  failWrites = fail;
}

/** Direct access for arranging test fixtures without going through saveBubbles. */
export function __seed(key: string, value: string): void {
  store.set(key, value);
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? store.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (failWrites) throw new Error('AsyncStorage is full');
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
};

export default AsyncStorage;
