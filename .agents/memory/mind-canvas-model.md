---
name: Mind Canvas bubble model
description: Core invariants of the Mind Canvas artifact — bubble-only content model, depth-driven sizing, and the non-overlap guarantee.
---

# Everything is a bubble

There is no separate "content" concept. A note, an item, a sub-task are all just
bubbles nested one level deeper. Nesting is allowed to depth 10.

**Why:** the user explicitly rejected text lists rendered inside a bubble — any
content within anything must itself be a bubble. Reintroducing a `content: string[]`
field (or pills/orbs that render text inside a circle) contradicts the product concept.

**How to apply:** when adding a feature that needs to show items belonging to a
bubble, create child bubbles rather than a list, a tooltip, or an expandable panel.

# Size is depth-driven only, never content-driven

Bubble diameter comes from a fixed per-depth table, not from how many children
it holds.

**Why:** a parent must *always* read as visibly larger than its children. Sizing by
child count lets a busy child outgrow its parent and destroys the hierarchy.

**How to apply:** never make size a function of descendant count.

# Bubbles must never overlap

Non-overlap is enforced every frame by a relaxation solver on *rendered* positions,
not by careful placement of stored positions. Stored `x`/`y` are only the "home"
intent; the solver produces what is drawn.

**Why:** float animation, dragging, and newly added bubbles all perturb positions
independently, so any placement-time-only check drifts back into overlap. Solving on
rendered positions each frame is the only formulation that holds under all three.

**How to apply:** separation is mass-weighted (mass ∝ radius²) so large pillars barely
move and small bubbles yield. The bubble currently being dragged is treated as
immovable so the drag never feels like it is fighting the solver. Parent-ring clamping
runs *after* pairwise separation within each iteration, and the list must be sorted
depth-ascending so parents settle before their children clamp to them.
