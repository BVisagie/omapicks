# Automation and publication

Four workflows cover validation, recommendation publication, current availability and editorial research. All schedules use UTC. Actions are pinned to reviewed commit SHAs; the shared setup action installs the exact Node version in `.nvmrc`, dependencies from the lockfile, and Chromium when needed.

| Workflow | Trigger | Result |
| --- | --- | --- |
| CI | Pull requests targeting `main`; pushes to `main` | Workflow lint, Node tests, production render and browser checks. Feature pushes do not duplicate PR checks. |
| Publish recommendations | Monday 06:17; manual | Validates and publishes a weekly snapshot, review queue and current availability. Explicit manual `republish` permits a deliberate same-week refresh. |
| Update availability | Daily 07:47; manual | Updates availability for displayed winners, runners-up and alternatives, independently of frozen scores and history. |
| Review evidence | Tuesday 06:43; Thursday 06:17; manual | Captures feeds and source evidence, prioritizes unresolved reviews, and validates proposed pages. Tuesday also runs category discovery; manual runs choose whether to include it. |

The unified evidence review replaces the separate category-discovery and midweek workflows. It cannot approve tasks, publish categories, create issues or push commits. Its ranking and discovery reports share the same captured catalog, engagement, taxonomy, reviews, profiles and repository observations. Optional explorer data is fetched once for discovery. The staged candidate includes the proposed rankings and current availability; tests, rendering and browser checks run against that copied site, leaving published data untouched.

## Publication boundary

Generation and validation jobs have read-only repository permissions and do not persist checkout credentials. Only the final publisher receives `contents: write`. That job installs no project dependencies, checks out the exact validated base commit, and downloads the same run's named data artifact. `scripts/publication.mjs` checks the artifact schema, mode, base SHA, publication week, duplicate paths, sizes and SHA-256 checksums before applying it.

The availability artifact can change only `data/availability.json`. Weekly publication can change the generated rankings, changelog, classification state/report, review queue, availability, the current week's history snapshot and strictly named preview assets. It cannot change code, configuration, review decisions, profiles or older history. Deletions are limited to preview assets. Symlink paths are refused. Generation that changes tracked files outside this allowlist fails packaging.

Both publishing workflows share the `recommendation-publication` concurrency group with `queue: max` and cancellation disabled. This serializes their entire generation/validation/publication sequence. The final publisher still fetches the default branch and refuses a stale base, because a human merge can advance it during validation. It uses an ordinary fast-forward push, with no force push, merge or rebase. A race after the final check causes the push to fail safely. **Start a new workflow run after a stale-base failure** so generation and all checks run on the new base; rerunning only the publisher cannot repair it.

Bot pushes using `GITHUB_TOKEN` do not trigger downstream push CI. Both publishers therefore run Node tests, production rendering and browser checks before packaging the data. An unchanged artifact creates no commit. Failure remains visible in Actions and never reports successful publication. Validated publication artifacts are kept for seven days; diagnostic evidence is retained for 90 days for recommendation/research runs and browser failure diagnostics for 14 days for CI/availability, subject to repository retention limits.

## Current availability

`node build/availability.mjs` reads a bounded current catalog and the published snapshot. It rejects an unsupported schema, stale/future/backwards catalog timestamp, invalid/duplicate IDs and a feed below the larger of 1,000 entries or 75% of the published catalog baseline. It writes only the displayed IDs to `data/availability.json`, binding observations to the exact `rankingsGeneratedAt` value.

A missing listing, changed repository, failed/unreachable upstream check or unavailable installation marks the current option unavailable. A missing upstream check is unknown. These are observations of the marketplace feed, not an independent execution or security review. Current pages suppress installation controls for unavailable options; frozen scores, historical snapshots and badges retain their recorded meaning. Missing, malformed or mismatched observations are shown as unknown.

Failed fetches or invalid feeds leave the previous artifact intact and fail the run with a summary. Re-reading an identical catalog snapshot with unchanged results creates no timestamp-only commit. A newer catalog produces a new observation even when all statuses agree. The site displays observation age so a retained observation does not imply a fresh check.

## Discovery state and review handoff

The research artifact contains captured inputs, the full review queue, priority assignments, a summary, discovery outputs when enabled, and any available browser diagnostics. Uploads run even after failure. Priority assignments include previous picks, prospective podium entries and assignments needing renewed review. These are research leads; queue disappearance alone is not an editorial decision.

State restoration searches at most 50 recent successful default-branch runs and inspects at most 20 eligible research runs. Only successful scheduled or manual runs of the unified research workflow or its predecessor can supply state. Branch experiments cannot become canonical observations. The state must have a recent observation (at most 21 days old) with the current discovery algorithm, taxonomy and settings hash. Incompatible/malformed/expired observations are skipped in favor of an older compatible artifact. A genuine GitHub API or download error fails the run; it cannot silently reset persistence.

Downloaded state is size-bounded, rejects symlinks, ambiguous state files and excessive directory depth/file counts, and exports a fixed destination to `GITHUB_ENV`. Artifact-controlled names never become workflow environment commands. Only a successful default-branch research run uploads the next canonical state. Algorithm or configuration changes intentionally establish a new compatible baseline when none exists.

Useful local commands:

```sh
node build/availability.mjs
node scripts/review-evidence.mjs
node scripts/review-evidence.mjs --without-discovery
node scripts/category-discovery.mjs --input /path/to/discovery-inputs.json
bash scripts/lint-workflows.sh
```

The live research command writes under `tmp/` and captures authenticated public GitHub evidence when `GH_TOKEN` is set. It does not publish recommendations. Discovery replay uses captured inputs; check out the recorded code revision before replaying an older algorithm. The workflow linter downloads checksum-pinned actionlint 1.7.12. Its one narrow ignore accommodates GitHub's documented `concurrency.queue` key, which that release's parser predates; all other workflow diagnostics remain errors.

## Deployment and rollout

The repository keeps its existing Cloudflare Workers Git integration and `wrangler.toml`. This PR does not change Cloudflare account settings, production branch configuration, deployment credentials or GitHub branch rules. No second deployment workflow is added.

Before treating the merged state as fully operational, verify these external settings and the first runs:

1. The production branch is `main`, and Cloudflare builds the same commit that passed the intended validation. PR previews must not replace production. Cloudflare's production build command should include the required validation (at least `npm run check`), or its deployment policy must explicitly gate the matching SHA on CI. A Git integration that deploys immediately on every human push is not made dependent on CI merely by adding this workflow.
2. A validated bot data push triggers the existing Cloudflare integration. GitHub's suppression of downstream Actions does not establish how an external Git integration behaves; verify the first actual deployment and its commit SHA. If bot pushes are ignored, configure that integration or deliberately add one authenticated deployment path after review.
3. The default-branch rules permit the narrowly scoped data publisher to push, and the intended PR checks are required for human changes. If rules require all changes through PRs, this direct-data publication design needs an explicit compatible exception or a deliberate switch to data PRs. Do not weaken rules silently.
4. Run **Review evidence** on `main`, inspect the preserved evidence and candidate checks, then run **Update availability**. Confirm that its diff contains only availability and that the deployed observation updates without changing rankings or history. Run **Publish recommendations** with `republish` only when a deliberate same-week publication is intended.
5. Confirm the Tuesday observation produces canonical state, Thursday remains report-only, and the next Tuesday restores a compatible state or explains a deliberate baseline reset. Watch for feed/source failures and stale snapshot/availability notices.

If a publisher fails, inspect its summary and archived evidence and start a fresh run after correcting the cause. Do not force-push or manually merge an old data artifact. For a bad published observation, revert the specific data commit through the normal reviewed path and investigate before resuming its schedule. For a behavior regression, revert the relevant code change and validate the retained historical snapshots before redeploying.
