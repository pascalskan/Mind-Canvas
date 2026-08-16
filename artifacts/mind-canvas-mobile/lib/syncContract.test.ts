/**
 * Cross-platform sync contract.
 *
 * Web and mobile do not share code — each keeps its own copy of the layout
 * maths, the persistence validators, and the save-metadata rules — and the API
 * server keeps a third copy of the validation. Every other test in this repo
 * checks ONE of those three in isolation, which is exactly the blind spot that
 * matters: the failures that actually break syncing are disagreements BETWEEN
 * them, and a disagreement is silent. Nothing throws. Both devices keep saving
 * happily to their own local storage while the shared map quietly stops moving
 * between them.
 *
 * So this file deliberately reaches across package boundaries and imports the
 * real modules from all three sides, then asserts they agree.
 *
 * Note the web module is imported by relative path rather than by package
 * name. That is intentional: the point is to test the code that actually
 * ships, not a copy of it that could drift.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mobile
import {
  canvasSignature as mobileSignature,
  buildInitialBubbles,
  abbreviateCrumb as mobileAbbreviate,
  CRUMB_LIMIT as MOBILE_CRUMB_LIMIT,
  labelZoomOpacity as mobileLabelOpacity,
  pillarLabelIsCompact as mobileCompact,
  fitCrumbs as mobileFitCrumbs,
  archiveWash as mobileWash,
  COMPLETE_TOTAL_MS as MOBILE_COMPLETE_MS,
  type CrumbMetrics,
  LABEL_FADE_FROM_PX as MOBILE_FADE_FROM,
  LABEL_FADE_TO_PX as MOBILE_FADE_TO,
} from './bubbleLayout';
import { parseBubbleJson, pushToCloud, fetchFromCloud } from './persistence';
import { STORAGE_VERSION, type BubbleData } from './bubbleTypes';
import { hslToHex } from './hslToHex';

// Web
import { canvasSignature as webSignature } from '../../mind-canvas/src/hooks/useBubbleState';
import {
  isValidBubble as webIsValidBubble,
  isValidBubbleGraph as webIsValidGraph,
  STORAGE_VERSION as WEB_STORAGE_VERSION,
} from '../../mind-canvas/src/persistence';

import {
  abbreviateCrumb as webAbbreviate,
  CRUMB_LIMIT as WEB_CRUMB_LIMIT,
  labelZoomOpacity as webLabelOpacity,
  pillarLabelIsCompact as webCompact,
  fitCrumbs as webFitCrumbs,
  archiveWash as webWash,
  COMPLETE_TOTAL_MS as WEB_COMPLETE_MS,
  LABEL_FADE_FROM_PX as WEB_FADE_FROM,
  LABEL_FADE_TO_PX as WEB_FADE_TO,
} from '../../mind-canvas/src/lib/bubbleLayout';

// Server
import { validateMapPayload } from '../../api-server/src/lib/mapPayload';

const SAMPLE: BubbleData[] = [
  { id: 'b0', label: 'Root',  x: 0,   y: 0,   color: '#a1a1c1', depth: 0 },
  { id: 'b1', label: 'Child', x: 120, y: 0,   color: '#b2c2a2', depth: 1, parentId: 'b0', angle: 0.5, radial: 0.25 },
  { id: 'b2', label: 'Pip',   x: 130, y: 44,  color: '#c3b3d3', depth: 2, parentId: 'b1', scale: 1.2 },
];

/**
 * The same map with notes on it. The text deliberately contains `~` and `|` —
 * the delimiters canvasSignature joins its other fields with. Real notes are
 * long free-form writing and will eventually contain both, and a signature
 * that let them collide would report "no unsaved changes" over work that was
 * never published.
 */
const SAMPLE_WITH_NOTES: BubbleData[] = [
  SAMPLE[0]!,
  {
    ...SAMPLE[1]!,
    notes: [
      { id: 'n1', text: 'ship by friday',        createdAt: 1_700_000_000_000 },
      { id: 'n2', text: 'edge case: a~b|c d',    createdAt: 1_700_000_050_000 },
    ],
  },
  SAMPLE[2]!,
];

beforeEach(() => {
  process.env['EXPO_PUBLIC_API_URL'] = 'http://localhost:8080';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_API_URL'];
});

// ─── Storage format ───────────────────────────────────────────────────────────

describe('storage version', () => {
  // The clients read each other's files and the same cloud row. A version bump
  // on one side alone makes the other reject every payload as "unrecognised
  // version" — which looks exactly like a corrupt file, not a mismatch.
  it('is the same number on both platforms', () => {
    expect(STORAGE_VERSION).toBe(WEB_STORAGE_VERSION);
  });
});

// ─── Unsaved-changes fingerprint ──────────────────────────────────────────────

describe('canvasSignature agrees byte-for-byte across platforms', () => {
  // This drives the unsaved-changes dot on both platforms. If the two
  // implementations disagree, one device reports "all changes saved" for a
  // canvas the other considers dirty — over the identical bytes.
  it.each([
    ['a plain map',                SAMPLE, undefined],
    ['a named map',                SAMPLE, 'Product strategy'],
    ['the seeded starter map',     buildInitialBubbles(), undefined],
    ['a single root',              [SAMPLE[0]], 'Solo'],
    ['a map carrying notes',       SAMPLE_WITH_NOTES, undefined],
    ['a named map with notes',     SAMPLE_WITH_NOTES, 'Annotated'],
  ])('matches for %s', (_label, bubbles, name) => {
    expect(mobileSignature(bubbles as BubbleData[], name))
      .toBe(webSignature(bubbles as never, name));
  });

  it('matches regardless of array order', () => {
    const reversed = [...SAMPLE].reverse();
    expect(mobileSignature(reversed)).toBe(webSignature(reversed as never));
    expect(mobileSignature(reversed)).toBe(mobileSignature(SAMPLE));
  });

  // Notes ride inside the same payload as the map, so an edit to one is an
  // unsaved change like any other. If the fingerprint ignored them, writing a
  // note would leave the unsaved dot dark and the note would never be pushed.
  it.each([
    ['adding the first note', SAMPLE, SAMPLE_WITH_NOTES],
    ['editing a note', SAMPLE_WITH_NOTES, SAMPLE_WITH_NOTES.map(b =>
      b.id === 'b1' ? { ...b, notes: [{ ...b.notes![0]!, text: 'ship by monday' }, b.notes![1]!] } : b)],
    ['deleting a note', SAMPLE_WITH_NOTES, SAMPLE_WITH_NOTES.map(b =>
      b.id === 'b1' ? { ...b, notes: [b.notes![0]!] } : b)],
  ])('both platforms see %s as a change', (_label, before, after) => {
    expect(mobileSignature(after)).not.toBe(mobileSignature(before));
    expect(webSignature(after as never)).not.toBe(webSignature(before as never));
    // and the two platforms still agree on what the changed map hashes to
    expect(mobileSignature(after)).toBe(webSignature(after as never));
  });

  // A bubble that never had notes and one whose last note was deleted must
  // hash identically, or removing the final note would leave the canvas
  // permanently "unsaved" against a save that already contains it.
  // Completing is an unsaved change like any other — if the fingerprint
  // ignored it, archiving a whole branch would leave the unsaved dot dark and
  // the completion would never reach the other device.
  it('both platforms see completing a bubble as a change', () => {
    const done = SAMPLE.map(b => (b.id === 'b1' ? { ...b, archivedAt: 1_700_000_000_000 } : b));
    expect(mobileSignature(done)).not.toBe(mobileSignature(SAMPLE));
    expect(webSignature(done as never)).not.toBe(webSignature(SAMPLE as never));
    expect(mobileSignature(done)).toBe(webSignature(done as never));
  });

  it('an absent notes array and a removed one hash the same', () => {
    const stripped = SAMPLE_WITH_NOTES.map(b => {
      const { notes: _drop, ...rest } = b;
      return rest as BubbleData;
    });
    expect(mobileSignature(stripped)).toBe(mobileSignature(SAMPLE));
    expect(webSignature(stripped as never)).toBe(webSignature(SAMPLE as never));
  });

  it('both platforms register the same edits as changes', () => {
    const edited = SAMPLE.map(b => b.id === 'b1' ? { ...b, label: 'Renamed' } : b);
    const mobileChanged = mobileSignature(edited) !== mobileSignature(SAMPLE);
    const webChanged = webSignature(edited as never) !== webSignature(SAMPLE as never);
    expect(mobileChanged).toBe(true);
    expect(webChanged).toBe(true);
  });

  it('both platforms ignore the same sub-pixel drift', () => {
    const drifted = SAMPLE.map(b => ({ ...b, x: b.x + 0.4, y: b.y - 0.4 }));
    expect(mobileSignature(drifted)).toBe(mobileSignature(SAMPLE));
    expect(webSignature(drifted as never)).toBe(webSignature(SAMPLE as never));
  });
});

// ─── Validation parity ────────────────────────────────────────────────────────

describe('the three validators accept and reject the same maps', () => {
  /** Runs a candidate map past mobile, web, and the server. */
  function verdicts(bubbles: unknown[]): { mobile: boolean; web: boolean; server: boolean } {
    const body = { version: STORAGE_VERSION, bubbles };
    return {
      mobile: parseBubbleJson(JSON.stringify(body)) !== null,
      web: (bubbles as BubbleData[]).length > 0
        && bubbles.every(webIsValidBubble)
        && webIsValidGraph(bubbles as BubbleData[]),
      server: validateMapPayload(body).ok,
    };
  }

  it('all three accept a well-formed map', () => {
    const v = verdicts(SAMPLE);
    expect(v).toEqual({ mobile: true, web: true, server: true });
  });

  it('all three accept a map carrying notes', () => {
    const v = verdicts(SAMPLE_WITH_NOTES);
    expect(v).toEqual({ mobile: true, web: true, server: true });
  });

  it('all three accept a completed bubble', () => {
    const v = verdicts([
      { ...SAMPLE[0], archivedAt: 1_700_000_000_000 },
      { ...SAMPLE[1], archivedAt: 1_700_000_000_000 },
    ]);
    expect(v).toEqual({ mobile: true, web: true, server: true });
  });

  it.each([
    ['a non-finite archivedAt', [{ ...SAMPLE[0], archivedAt: null }]],
    ['a string archivedAt',     [{ ...SAMPLE[0], archivedAt: 'yes' }]],
  ])('all three reject %s', (_label, bubbles) => {
    expect(verdicts(bubbles as unknown[])).toEqual({ mobile: false, web: false, server: false });
  });

  it('all three accept an empty notes array', () => {
    const v = verdicts([{ ...SAMPLE[0], notes: [] }]);
    expect(v).toEqual({ mobile: true, web: true, server: true });
  });

  // The server must not quietly drop notes on the way through: it rebuilds the
  // top-level payload, and if bubbles were rebuilt field-by-field too, every
  // note would vanish on the first save with nothing reported as wrong.
  it('the server stores notes rather than stripping them', () => {
    const result = validateMapPayload({ version: STORAGE_VERSION, bubbles: SAMPLE_WITH_NOTES });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bubbles[1]!.notes).toEqual(SAMPLE_WITH_NOTES[1]!.notes);
  });

  it.each([
    ['an empty map',              []],
    ['a missing required field',  [{ id: 'x', label: 'no coords' }]],
    // JSON.stringify turns NaN into null, so this is the exact shape a
    // poisoned client puts on the wire — the one that silently killed sync.
    ['a null coordinate',         [{ ...SAMPLE[0], x: null }]],
    ['a non-finite scale',        [{ ...SAMPLE[0], scale: null }]],
    ['a duplicate id',            [SAMPLE[0], { ...SAMPLE[0], label: 'clash' }]],
    ['an orphaned parentId',      [{ ...SAMPLE[0], id: 'kid', parentId: 'ghost' }]],
    ['a parent cycle',            [
      { ...SAMPLE[0], id: 'a', parentId: 'b' },
      { ...SAMPLE[0], id: 'b', parentId: 'a' },
    ]],
    // One malformed note would otherwise make every device reject the WHOLE
    // map and fall back to its own local draft, with nothing to explain why.
    ['notes that are not an array', [{ ...SAMPLE[0], notes: 'a note' }]],
    ['a note that is not an object', [{ ...SAMPLE[0], notes: ['a note'] }]],
    ['a note with no id',           [{ ...SAMPLE[0], notes: [{ text: 'x', createdAt: 1 }] }]],
    ['a note with an empty id',     [{ ...SAMPLE[0], notes: [{ id: '', text: 'x', createdAt: 1 }] }]],
    ['a note with no text',         [{ ...SAMPLE[0], notes: [{ id: 'n', createdAt: 1 }] }]],
    ['a note with numeric text',    [{ ...SAMPLE[0], notes: [{ id: 'n', text: 5, createdAt: 1 }] }]],
    ['a note with a null createdAt',[{ ...SAMPLE[0], notes: [{ id: 'n', text: 'x', createdAt: null }] }]],
  ])('all three reject %s', (_label, bubbles) => {
    const v = verdicts(bubbles as unknown[]);
    expect(v).toEqual({ mobile: false, web: false, server: false });
  });
});

// ─── Label visibility ─────────────────────────────────────────────────────────

describe('label fade agrees across platforms', () => {
  // Both platforms hold their own renderer but must agree on when a label is
  // readable. A disagreement here is silent: the same canvas simply shows
  // different names on the phone and the website.
  const DIAMETERS = [0, 8, 19, 27, 28, 30, 40, 51, 52, 90, 400];

  it.each(DIAMETERS)('matches for a child bubble at %ipx', (d) => {
    expect(mobileLabelOpacity(d, false)).toBe(webLabelOpacity(d, false));
  });

  it.each(DIAMETERS)('matches for a pillar at %ipx', (d) => {
    expect(mobileLabelOpacity(d, true)).toBe(webLabelOpacity(d, true));
  });

  it('uses the same fade thresholds on both platforms', () => {
    expect(MOBILE_FADE_FROM).toBe(WEB_FADE_FROM);
    expect(MOBILE_FADE_TO).toBe(WEB_FADE_TO);
  });

  // The point of the exemption: a pillar is the thing you orient by, so its
  // name has to survive the zoom-out that strips every other label.
  it.each(DIAMETERS)('never fades a pillar, at %ipx', (d) => {
    expect(mobileLabelOpacity(d, true)).toBe(1);
  });

  it('still fades a non-pillar right down at distance', () => {
    expect(mobileLabelOpacity(MOBILE_FADE_TO, false)).toBe(0);
    expect(mobileLabelOpacity(MOBILE_FADE_TO - 10, false)).toBe(0);
    expect(mobileLabelOpacity(MOBILE_FADE_FROM, false)).toBe(1);
    // and still eases through the middle rather than snapping
    const mid = mobileLabelOpacity((MOBILE_FADE_FROM + MOBILE_FADE_TO) / 2, false);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('the compact pillar label agrees across platforms', () => {
  const DIAMETERS = [0, 19, 27, 51, 52, 90];

  it.each(DIAMETERS)('matches at %ipx', (d) => {
    expect(mobileCompact(d, true)).toBe(webCompact(d, true));
    expect(mobileCompact(d, false)).toBe(webCompact(d, false));
  });

  // Exempting a pillar from the fade is not enough on its own: the font size
  // has a floor while the bubble keeps shrinking, so past this point the label
  // no longer fits inside its own circle and must stop wrapping.
  it('kicks in exactly where the fade used to start hiding the label', () => {
    expect(mobileCompact(MOBILE_FADE_FROM, true)).toBe(false);
    expect(mobileCompact(MOBILE_FADE_FROM - 1, true)).toBe(true);
    expect(mobileCompact(19, true)).toBe(true);
  });

  it('never applies to a non-pillar, which fades out instead', () => {
    expect(mobileCompact(19, false)).toBe(false);
    expect(mobileCompact(0, false)).toBe(false);
  });
});

// ─── Archived styling ─────────────────────────────────────────────────────────

describe('the archive wash agrees across platforms', () => {
  // The two clients do not store colour the same way — the website writes
  // hsl(), the app writes hex — and both formats travel in the same synced
  // map. A bubble made on one device and completed on the other has to come
  // out the same shade either way.
  const COLORS = [
    'hsl(250,60%,65%)', 'hsl(40,65%,65%)', 'hsl(170,40%,55%)',
    '#8a7ad6', '#d98fb0', '#4fb39a', '#FFF', '#000000',
  ];

  it.each(COLORS)('matches for %s', (color) => {
    expect(mobileWash(color, 0.15)).toBe(webWash(color, 0.15));
    expect(mobileWash(color, 0.55)).toBe(webWash(color, 0.55));
  });

  // hsl(250,60%,65%) and its hex are the same colour written twice; the wash
  // has to agree with itself across the two spellings or a synced map would
  // show one branch in two shades.
  it('treats the same colour spelled two ways identically', () => {
    // hslToHex(250, 60, 65) is what the app stores for the website's first
    // pillar colour.
    expect(mobileWash('hsl(250,60%,65%)', 0.15))
      .toBe(mobileWash(hslToHex(250, 60, 65), 0.15));
  });

  it('keeps nothing at 0 and everything at 1', () => {
    expect(mobileWash('#336699', 0)).toBe('rgb(255, 255, 255)');
    expect(mobileWash('#336699', 1)).toBe('rgb(51, 102, 153)');
  });

  it('hands back anything it cannot parse rather than guessing', () => {
    expect(mobileWash('rebeccapurple', 0.5)).toBe('rebeccapurple');
    expect(mobileWash('', 0.5)).toBe('');
  });

  it('uses the same completion timing on both platforms', () => {
    expect(MOBILE_COMPLETE_MS).toBe(WEB_COMPLETE_MS);
  });
});

// ─── Breadcrumb fitting ───────────────────────────────────────────────────────

describe('the breadcrumb spends only the room it has', () => {
  /** The mobile bar on a 393pt phone — the case that was overhanging. */
  const PHONE: CrumbMetrics = {
    barWidth: 393 - 64 - 12,
    fixed: 24 + 22, chevron: 16, crumbPadding: 8, currentExtra: 13,
    ellipsis: 22, charWidth: 7, minChars: 6, maxChars: 18, comfortChars: 15,
  };
  /** The web bar on a 1280px window. */
  const DESKTOP: CrumbMetrics = {
    barWidth: 1280 - 320,
    fixed: 32, chevron: 14, crumbPadding: 0, currentExtra: 0,
    ellipsis: 14, charWidth: 6.2, minChars: 8, maxChars: 26, comfortChars: 20,
  };

  /** What the bar will actually be, in the platform's units. */
  function widthOf(count: number, fit: { currentChars: number; ancestorChars: number },
                   total: number, m: CrumbMetrics): number {
    const hidesOlder = total > count;
    return m.fixed
      + count * (m.chevron + m.crumbPadding)
      + m.currentExtra
      + (hidesOlder ? m.ellipsis + m.chevron : 0)
      + (fit.currentChars + (count - 1) * fit.ancestorChars) * m.charWidth;
  }

  it.each([1, 2, 3, 4, 6, 10])('agrees across platforms at depth %i', (total) => {
    expect(mobileFitCrumbs(total, PHONE)).toEqual(webFitCrumbs(total, PHONE));
    expect(mobileFitCrumbs(total, DESKTOP)).toEqual(webFitCrumbs(total, DESKTOP));
  });

  // The point of the whole exercise: the bar must stop running off the screen.
  it.each([1, 2, 3, 4, 6, 10])('stays inside the phone bar at depth %i', (total) => {
    const fit = mobileFitCrumbs(total, PHONE);
    expect(widthOf(fit.count, fit, total, PHONE)).toBeLessThanOrEqual(PHONE.barWidth);
  });

  it.each([1, 2, 3, 4, 6, 10])('stays inside the desktop bar at depth %i', (total) => {
    const fit = mobileFitCrumbs(total, DESKTOP);
    expect(widthOf(fit.count, fit, total, DESKTOP)).toBeLessThanOrEqual(DESKTOP.barWidth);
  });

  // The current bubble and its parent answer "where am I". Nothing may drop
  // them, however cramped the bar gets.
  it.each([320, 360, 393, 430, 600, 1280])('keeps parent and current at %ipx wide', (w) => {
    const fit = mobileFitCrumbs(8, { ...PHONE, barWidth: w - 76 });
    expect(fit.count).toBeGreaterThanOrEqual(2);
  });

  it('never shows more of the trail than exists', () => {
    expect(mobileFitCrumbs(1, DESKTOP).count).toBe(1);
    expect(mobileFitCrumbs(2, DESKTOP).count).toBe(2);
    expect(mobileFitCrumbs(0, DESKTOP).count).toBe(0);
  });

  // A wider bar should never buy you LESS of the trail.
  it('never shrinks the trail as the screen grows', () => {
    let prev = 0;
    for (const w of [200, 260, 320, 400, 500, 700, 960]) {
      const fit = mobileFitCrumbs(10, { ...PHONE, barWidth: w });
      expect(fit.count).toBeGreaterThanOrEqual(prev === 0 ? 0 : prev);
      prev = fit.count;
    }
  });

  // The double share only has to show when space is scarce. Given plenty, both
  // reach the ceiling and nobody is shortchanged — which is the right outcome,
  // not a failure of the priority.
  it('favours the current bubble when room is tight', () => {
    const tight = mobileFitCrumbs(6, { ...DESKTOP, barWidth: 300 });
    expect(tight.currentChars).toBeGreaterThan(tight.ancestorChars);
  });

  it('lets both reach the ceiling when room is plentiful', () => {
    const roomy = mobileFitCrumbs(6, { ...DESKTOP, barWidth: 1600 });
    expect(roomy.ancestorChars).toBe(DESKTOP.maxChars);
    expect(roomy.currentChars).toBe(DESKTOP.maxChars);
  });

  it('honours its own floor and ceiling on characters', () => {
    for (const w of [120, 200, 300, 600, 4000]) {
      const fit = mobileFitCrumbs(6, { ...DESKTOP, barWidth: w });
      expect(fit.ancestorChars).toBeGreaterThanOrEqual(DESKTOP.minChars);
      expect(fit.currentChars).toBeLessThanOrEqual(DESKTOP.maxChars);
    }
  });

  // A desktop window has room for the full window of levels.
  it('shows the full window on a desktop', () => {
    expect(mobileFitCrumbs(10, DESKTOP).count).toBe(3);
  });
});

// ─── Breadcrumb labels ────────────────────────────────────────────────────────

describe('breadcrumb abbreviation agrees across platforms', () => {
  // Both platforms shorten crumbs so a deep trail cannot push the bar across
  // the canvas. The budgets differ by screen, but the rule that produces the
  // text must not — the same canvas should read the same way on both.
  const CASES: [string, number][] = [
    ['Personal', 9],
    ['Personal', 15],
    ['Music Commercials', 9],
    ['Music Commercials', 15],
    ['Music Commercials', 22],
    ['Cold Call January Push', 9],
    ['Cold Call January Push', 15],
    ['Supercalifragilisticexpialidocious', 9],
    ['  spaced   out   words  ', 14],
    ['', 9],
    ['A', 9],
  ];

  it.each(CASES)('matches for %j at %i chars', (labelText, maxChars) => {
    expect(mobileAbbreviate(labelText, maxChars)).toBe(webAbbreviate(labelText, maxChars));
  });

  it('uses the same crumb limit on both platforms', () => {
    expect(MOBILE_CRUMB_LIMIT).toBe(WEB_CRUMB_LIMIT);
  });

  it.each(CASES)('never exceeds its budget for %j at %i chars', (labelText, maxChars) => {
    const out = mobileAbbreviate(labelText, maxChars);
    // The ellipsis is the one character allowed past the budget.
    expect(out.replace(/…$/, '').length).toBeLessThanOrEqual(maxChars);
  });

  it('leaves a label that already fits completely alone', () => {
    expect(mobileAbbreviate('Personal', 15)).toBe('Personal');
    expect(mobileAbbreviate('Personal', 8)).toBe('Personal');
  });

  it('keeps whole words rather than cutting mid-word', () => {
    // "Cold Call" is exactly 9, so it survives whole; the cut lands on a space
    // either way rather than part-way through a word.
    expect(mobileAbbreviate('Cold Call January Push', 9)).toBe('Cold Call…');
    expect(mobileAbbreviate('Cold Call January Push', 8)).toBe('Cold…');
  });

  it('leaves it alone when the whole label fits, however many words', () => {
    expect(mobileAbbreviate('one two three', 13)).toBe('one two three');
  });

  it('stops at two words even when a third would fit the budget', () => {
    // "a b c" (5) would fit in 6, but a third word buys little for its width.
    expect(mobileAbbreviate('a b c ddddddddddd', 6)).toBe('a b…');
  });

  it('cuts inside a word only when one word is wider than the budget', () => {
    expect(mobileAbbreviate('Supercalifragilistic', 9)).toBe('Supercali…');
  });
});

// ─── Wire format ──────────────────────────────────────────────────────────────

describe('what mobile PUTs is what the server accepts', () => {
  it('a real mobile save passes server validation unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, { name: 'Trip planning', savedAt: 1_700_000_000_000, savedBy: 'mobile' });

    // Take the ACTUAL body off the wire rather than reconstructing it.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    const result = validateMapPayload(sent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Trip planning');
      expect(result.value.savedBy).toBe('mobile');
      expect(result.value.savedAt).toBe(1_700_000_000_000);
      expect(result.value.bubbles).toEqual(SAMPLE);
    }
  });

  it('a save with no name omits the field rather than sending null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushToCloud(SAMPLE, { savedAt: 1, savedBy: 'mobile' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    // `name: null` would fail the server's string check and reject the save.
    expect(sent.name === undefined || typeof sent.name === 'string').toBe(true);
    expect(validateMapPayload(sent).ok).toBe(true);
  });

  it('mobile reads back exactly what the server would store from a web save', async () => {
    // A web save, run through the server's own validator, then handed to
    // mobile's fetch path — the full cross-device round trip in one assertion.
    const webBody = {
      version: WEB_STORAGE_VERSION,
      bubbles: SAMPLE,
      name: 'From the website',
      savedAt: 1_700_000_000_500,
      savedBy: 'web' as const,
    };
    const validated = validateMapPayload(webBody);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => validated.value,
    }));

    const snap = await fetchFromCloud();
    expect(snap?.bubbles).toEqual(SAMPLE);
    expect(snap?.meta).toEqual({
      name: 'From the website', savedAt: 1_700_000_000_500, savedBy: 'web',
    });
  });

  it('an export written by mobile is importable and server-valid', () => {
    // Mirrors what exportMap writes, including the name that a round trip has
    // to preserve.
    const file = JSON.stringify({ version: STORAGE_VERSION, bubbles: SAMPLE, name: 'Exported' });

    const reimported = parseBubbleJson(file);
    expect(reimported?.bubbles).toEqual(SAMPLE);
    expect(reimported?.name).toBe('Exported');

    expect(validateMapPayload(JSON.parse(file)).ok).toBe(true);
  });
});
