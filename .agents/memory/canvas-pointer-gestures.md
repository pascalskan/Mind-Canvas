---
name: Canvas pointer gesture separation
description: Why lock/rename/drag gestures on a canvas bubble must be separated by pointer ownership rather than time windows, and the pointer-capture crash that hides behind it.
---

# Separate overlapping click gestures by pointer ownership, not by time windows

When one element supports several click gestures that unlock each other — e.g. a
double-click "locks" a bubble and locking makes its inner label clickable to rename —
do NOT disambiguate with elapsed-time checks. Require the gesture to both START and
END on the element that owns it (record ownership on `pointerdown`, act on `click`),
and additionally suppress the click that *completes* the enabling gesture.

**Why:** time windows fail in two directions that are hard to see and easy to
misdiagnose:
- Keying "was this just locked?" off the *last click* self-defeats, because the
  bubble's own pointer-up handler stamps that timestamp on every click — so the
  legitimate rename click a second later still looks like it just locked, and is
  silently swallowed.
- The lock can fire on the FIRST click of a double-click when an earlier, unrelated
  click left the double-click window still open. The element becomes interactive
  mid-gesture, so the second click genuinely starts and ends on it and opens the
  wrong action. Pointer ownership alone does not cover this case, which is why both
  guards are needed together.

**How to apply:** the inner element stops propagation on `pointerdown` AND
`pointerup`, sets an "armed" ref on its own `pointerdown`, and only runs its action on
`click` if armed. The outer element additionally records when the enabling state
actually changed and ignores a click within ~350ms of it.

# Releasing an uncaptured pointer throws

If a press begins on a child that stopped `pointerdown`, the parent never called
`setPointerCapture` — but the parent's `pointerup` may still run via bubbling and call
`releasePointerCapture`, which throws and aborts the rest of that handler.

**Why:** this presents as a completely unrelated feature silently not working (the
handler dies partway), plus a vague React component error, so it sends you looking in
the wrong place.

**How to apply:** guard with `hasPointerCapture(e.pointerId)` before releasing, and
stop `pointerup` propagation on any child that stops `pointerdown`.

# Testing agent reports on this canvas are unreliable — demand raw DOM

Reports here repeatedly contradicted their own screenshots (claiming an active textbox
in the accessibility tree when none was rendered) and clicked neighbouring bubbles
instead of the intended one.

**How to apply:** ask for raw evaluated DOM output
(`document.querySelectorAll('input')` mapped to placeholder/value) rather than a
pass/fail judgement, and require clicks at an explicitly computed bounding-box centre.
One such diagnostic round resolved several contradictory "failures" that were test
artifacts, not bugs.
