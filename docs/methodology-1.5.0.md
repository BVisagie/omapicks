# Methodology 1.5.0: keep a changed pick while it is re-checked

Under 1.3.0 and 1.4.0, a qualified review is tied to one commit. When any non-documentation file or cited document in the plugin's repository changes, the assignment becomes `stale-source` and leaves the shortlist at the next publication. That is the safe default, but it removes the plugins people use most first, because they are the ones still being developed.

The 2026-W46 publication showed the cost. 28 of the 159 plugins whose repositories were observed had changed since review. Six champions and eighteen runners-up left. Over three weeks, runners-up fell from 64 to 46 and the mean champion score from 0.908 to 0.804. The departing picks were replaced by lower-scoring options or by nothing, although none of them had been found to stop doing its task.

This release changes one eligibility rule. Scores, weights, normalization, freshness, tie-breaks, task contracts, pinned sources, shared requirements and the eight-day observation limit are unchanged from 1.4.0.

## The rule

A plugin keeps its place, labelled *re-check pending*, when all of these hold:

1. It was the champion or runner-up of that category in the previous publication.
2. Its qualified review and shared requirements otherwise pass every 1.4.0 check, and its listing metadata is unchanged.
3. The repository observation is recent, for the commit the catalog lists, and shows a change.
4. Every cited passage, for the task and for the requirements, still appears word for word at the new commit. Line numbers may move.
5. The manifest's `entryPoints` and `kinds` are unchanged. A version bump or new settings do not count.
6. Fewer than two weekly publications have passed since its grace began.

Grace starts at the first publication that relies on it and is recorded with the pick as `recheckSince`. Weeks are counted from the UTC Monday of each ISO week, so a same-week republish does not use up a publication. At the third weekly publication the pick is treated as `stale-source`, as it would have been under 1.4.0.

A pick in grace still enters the review queue as `stale-source`, so the re-check tool and the weekly handoff pick it up. Grace never applies to a plugin that was not already a pick, so it cannot introduce or promote a recommendation that has not been reviewed at its current commit. A plugin in grace can still be outscored and lose its place on popularity alone.

## Why these checks

Almost every release touches `README.md` and bumps the manifest version, so a rule that ended grace on any change to a cited file or the manifest would have applied to 2 of the 27 changed former picks in W46. Under the passage rule, 16 of them would have qualified. The other 11 had rewritten the passages their reviews cite, and they correctly wait for a new review. Most of the 16 had left before W45, and grace covers only the latest publication's picks, so replaying the W46 inputs against the W45 snapshot keeps 6 of them: 71 champions and 50 runners-up instead of 70 and 46. Grace slows the loss; it does not replace re-checking.

The passage check confirms that the documented capability is still claimed in the same words. The manifest check confirms that the plugin still loads through the same surfaces. Neither is a review of the new code, and the label says so. A failed fetch during capture records `recheck.status: "unavailable"`, which grants no grace.

## What readers see

- A pick in grace shows "Re-check pending: the repository changed after review. The reviewed passages still appear in the new version."
- When a pick leaves because its repository changed, the change log says it "is being re-checked after its repository changed" instead of the general "awaiting task qualification".
- A category page whose second or only place is empty for that reason names the plugin being re-checked.

## Verification

- `test/recheck-grace.test.mjs` covers the first and second week of grace, expiry at the third, and refusal for a plugin that was not a pick, a removed passage, a changed entry point, unavailable re-check evidence and 1.4.0. It also covers snapshot validation of an expired grace and capture of re-check evidence.
- `test/task-coherence-migration.test.mjs` replays the 1.4.0 migration unchanged; only the code pins were refreshed.
- Earlier snapshots keep their own methodology, and a 1.4.0 replay never grants grace.
