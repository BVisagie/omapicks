# OmaPicks

An independent weekly ranking of Omarchy plugins, published as a static site at omapicks.com. It
is plain Node ES modules, with no framework and no runtime packages. `docs/README.md` indexes the
guides. This file holds the rules that are easy to break without noticing.

**The repository is public, and `main` is production.** Cloudflare builds and deploys `main` with
no deployment workflow in between, so a merge reaches the live site.

| Path | Role |
| --- | --- |
| `build/` | Ranking, methodology, weekly refresh and the static site renderer |
| `data/` | Published snapshots and editorial decisions |
| `site/` | Styles, the browser script, icons and `discovery.json` |
| `functions/`, `workers/` | The Worker that serves `dist/` and records page views |
| `scripts/` | Review, discovery, publication and the private site report |
| `test/`, `e2e/` | Node tests and Playwright browser tests |
| `docs/` | Guides, methodology decision records and dated reports |

## Commands

Run checks on the Node version in `.nvmrc`. Plain `node` can be newer, and `mise exec --` ignores
`.nvmrc` by default, so with mise use `mise exec node@$(cat .nvmrc) -- <command>`. A new worktree
needs `npm ci`.

CI runs these three, so run them before a pull request:

```bash
bash scripts/lint-workflows.sh
npm run check      # Node tests, then the production build
npm run test:e2e   # needs Chromium: npx playwright install chromium
```

`npm run refresh` rewrites published data, and `npm run availability` rewrites
`data/availability.json`. To look at a refresh without changing anything, use
`npm run refresh -- --dry-run`, which writes only under `tmp/`.

## Rules that are easy to break

### Data

- **Never hand-edit generated data:** `rankings`, `changelog`, `classification-state`,
  `unclassified-report`, `task-review-queue` and `availability` in `data/*.json`, plus
  `data/history/` and `data/assets/plugins/`. Change the inputs or the code, and let the
  publishing workflows write them.
- Editorial decisions live in `data/task-reviews.json`, `data/plugin-profiles.json` and
  `data/app-types.json`. Change them by the process in `docs/classification.md`.
- Several data files are over 1 MB. Read slices with `jq` or `node -e`, not whole files. The same
  goes for `docs/analysis/*.json`.

### Ranking and evidence

- A new eligibility, scoring or selection rule needs a new version in `build/methodology.mjs` and
  a decision record at `docs/methodology-<version>.md`. Published definitions and older snapshots
  in `data/history/` never change, because the site explains each snapshot with its own version.
- Never relax a task definition to keep an incumbent or fill a second card.
- Only reviewed source evidence qualifies a plugin. Catalog text and popularity cannot.
- Never claim an installation test that was not performed.
- `test/task-coherence-migration.test.mjs` pins the hashes of twelve ranking and build files.
  After an intended change to one, it fails with `stale migration code`: update the pin in
  `docs/analysis/2026-10-30-migration.json` and `test/fixtures/task-coherence-migration.json.gz`,
  and keep every replayed result the same. A changed result is a finding, not a pin to refresh.

### Publishing and workflows

- Only the final publish job has `contents: write`. It installs no project dependencies, and
  `scripts/publication.mjs` limits what it can change. Never widen either without the owner.
- A publisher that fails on a stale base needs a new workflow run, not a rerun of the job. Never
  force-push or hand-merge a data artifact.
- Actions stay pinned to full commit SHAs with a version comment. Every job has a
  `timeout-minutes`, and permissions stay at the least each job needs.

### Privacy and the site report

- Never put traffic or Search Console figures, account or project IDs, or anything from a
  decrypted report into a commit, pull request, issue, log or other public text.
- Site report logs show each section's status. An error names the service, HTTP status and error
  code, never a response body.
- Reports are encrypted to the owner's key, and only the owner opens them. Never ask for the
  passphrase or the key file.
- The site has no accounts, comments, advertising or marketing trackers, and browsers get no
  analytics script, cookie or storage. A change to what the Worker records updates the `/privacy/`
  page in the same pull request, and `MEASUREMENT_VERSION` if the event layout changes.

### External services

- A fake in a test cannot prove a real service accepts a request. Cloudflare's Analytics Engine
  rejects nested subqueries, which the test fake allowed. After changing a query or an API call,
  check it against the real service, or say that it is unverified.

### Packages and pinned inputs

- Deployed code imports no npm packages, and the project has two dev dependencies. Before proposing
  a package, check its maintainer, official repository, advisories and provenance, then ask the
  owner.
- The crawler list and the `age` release are pinned by hash. Update them only by the steps in
  `docs/automation.md`.

### Tests

- Nothing may depend on today's date. Pass a fixed `now`. The home page's featured pick changes
  with the UTC day, and a test that assumed otherwise failed only on some days.
- The browser tests also run in Update availability and Publish recommendations, so a flaky test
  stops publication, not just CI. Wait for a state instead of sampling at fixed intervals.

### Public wording

- OmaPicks is one word. Never present it as "Omarchy Plugins", which is the marketplace's name, and
  keep the statement that it is not affiliated with Omarchy, 37signals or omarchyplugins.com.
- Commits and pull requests are read by anyone. Say what changed and how it was checked, and leave
  out tool errors and working notes.
- The dated reports listed in `docs/README.md` record a moment. Leave them as they are.

## Running a task

**Keep going when a step does not need the owner.** Do not stop to offer to continue, or to list
choices that do not block the work.

**Stop and ask before any of these, unless the owner already asked for it in this task:**

- pushing to `main`;
- starting a workflow;
- running `npm run refresh` without `--dry-run`, or `npm run availability`;
- deploying, or changing a Cloudflare, Google or GitHub setting, secret or ruleset;
- deleting a branch, tag, artifact or data;
- force-pushing, rewriting pushed history or skipping a hook.

Merging is always the owner's. Ask with the question tool (`AskUserQuestion` in Claude Code,
`request_user_input` in Codex), or end your message with the question.

`.claude/settings.json` and `.codex/rules/omapicks.rules` enforce most of this list, and all three
must say the same thing. They refuse merges, secrets, deploys, force and deleting pushes, ruleset
access, direct GraphQL calls and skipped hooks even when the owner asked, so hand those to the
owner to run. A session that cannot show a prompt refuses what would otherwise ask. These files
match command text, so they catch mistakes rather than stop a determined caller. Never work
around one.

**Done means** the checks above pass on the pinned Node and the docs are true. When a change makes
something in `docs/`, `README.md` or this file untrue, fix it in the same pull request.

**Mark what you could not confirm.** Name what you did not run, and label any claim about a
provider or API that no test, measurement or documentation confirmed.

**End with** the review state, then what needs the owner, then what changed and how it was checked.

## Git and pull requests

- Work in your own worktree: `git worktree add -b <branch> <path> origin/main`, then `npm ci`.
  Other agents share the main checkout, so never switch branches, commit or reset there.
- Add files by name. The main checkout can hold untracked work that is not yours.
- Land changes through a pull request. GitHub only blocks deleting `main` and force-pushing to it,
  so a direct push would deploy unreviewed. The publishing workflows are the one exception.
- A commit message ends with a `Co-Authored-By:` line naming the model. A pull request description
  ends with the model and the tool it ran in, and has a `## Review` section for its head commit.

## Review rules

These apply to any reviewer. Every rule in this file is a review rule: a broken one blocks the
merge, as does a doc left untrue. Taste does not. Report each finding's file and line, the rule it
breaks, and evidence or a way to reproduce it.
