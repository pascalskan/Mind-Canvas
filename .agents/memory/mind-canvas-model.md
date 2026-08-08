---
name: Mind Canvas bubble model
description: Durable rules for the bubble data model, layout, sizing, and animation loop.
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

# Size is content-driven, but capped against the parent

Rendered diameter = the layer's base size × a saturating function of the bubble's
ENTIRE subtree size, then hard-capped to a fraction of its parent's rendered size.

**Why:** the user wants a bubble's size to show how much is inside it, and wants a
bubble added ten levels down to visibly grow its top-level pillar — hence whole
subtree, not direct children. The cap exists because content sizing *will* otherwise
let a busy child outgrow its parent, which destroys the nesting read. Both halves are
required; keeping only the first reintroduces the bug the cap was added for.

**How to apply:** the growth curve must saturate (weight/(weight+k)), never be linear —
an unbounded curve lets one huge branch balloon off screen. Size the parent before the
child so the cap has something to clamp against, which means iterating the visible set
sorted by relative layer ascending.

# On-screen geometry comes from the RELATIVE layer, never from stored coordinates

Only three layers are ever visible. On-screen size and each child's leash band are
derived from the relative layer (0 = the bubble you are inside, 1 = its children,
2 = grandchild dots), never from stored `x`/`y`.

A child's placement is stored as an `angle` plus a `radial` fraction of that band —
NOT as a distance. The fraction is resolved against rendered sizes each frame, so the
same stored value means "a third of the way out" at every depth. Storing an absolute
distance instead is what broke deep levels; storing nothing at all is what made drags
fail to stick and the canvas look frozen. The band definition must be shared by the
layout, the drag and the collision solver — if the solver computes its own band, it
silently drags bubbles back out of the spot the user just put them in.

**Why:** stored coordinates were laid out for a bubble's *absolute* depth. A depth-8
bubble is a ~43px world object but renders at ~132px once you are standing inside it,
so reusing its stored radius crushes the whole level into an overlapping cluster.
This was the root cause of "deep levels don't behave like shallow ones" — shallow
levels looked fine purely because their stored and rendered sizes happened to agree.

**How to apply:** keep ONE layout function that returns positions + a size resolver
for a given focus target, and drive both the animation loop and the camera fit from
it. Never let the camera measure stored world coordinates while the renderer draws
recomputed ones — the camera then frames a region nothing is actually drawn in, and
clicks land on stale positions. Any collision/leash code must take the size resolver
as a parameter rather than calling the absolute-depth size function.

# Do not make an "open a panel" control a toggle

Controls that open a panel (e.g. Add bubble) call an explicit open, not `v => !v`.

**Why:** the canvas also closes panels on background pointer-down, so a toggle turns
an innocent second click into a silent close and the control reads as broken.

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
