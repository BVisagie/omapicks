# Automation and publication

Five workflows cover validation, recommendation publication, current availability, editorial research and a private site report. All schedules use UTC. Actions are pinned to reviewed commit SHAs; the shared setup action installs the exact Node version in `.nvmrc`, dependencies from the lockfile, and Chromium when needed.

| Workflow | Trigger | Result |
| --- | --- | --- |
| CI | Pull requests targeting `main`; pushes to `main` | Workflow lint, Node tests, production render and browser checks. Feature pushes do not duplicate PR checks. |
| Publish recommendations | Monday 06:17; manual | Validates and publishes a weekly snapshot, review queue and current availability. Explicit manual `republish` permits a deliberate same-week refresh. |
| Update availability | Daily 07:47; manual | Updates availability for displayed winners, runners-up and alternatives, independently of frozen scores and history. |
| Review evidence | Tuesday 06:43; Thursday 06:17; manual | Captures feeds and source evidence, prioritizes unresolved reviews, and validates proposed pages. Tuesday also runs category discovery; manual runs choose whether to include it. |
| Site report | Manual only | Builds the private traffic, search and site report and uploads it encrypted. Nothing readable is published. |

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

## Private site report

Start **Site report** under Actions and choose 7, 28 or 90 days. It reads Cloudflare traffic, Google Search Console, the committed rankings data and the last 30 days of Actions history, then uploads one encrypted file, `site-report-encrypted`, kept for 30 days. The repository is public, so the run page, logs and summary show only each section's status: `ok`, `not-configured`, or an error that names the failing service and its HTTP status and error code, never a response body.

### What protects it

- **Who can run it.** Manual runs only, and the job stops unless it runs on the default branch. Its secrets live in the `site-report` environment, which only `main` may use, so code pushed on any other branch cannot read them.
- **What it can do.** `contents: read`, `actions: read`, and `id-token: write` so it can ask GitHub for its own identity token for Google. It never commits, deploys or installs npm packages. Its only actions are GitHub's own, pinned by SHA. The one outside program is age v1.3.2, whose SHA-256 is pinned in `scripts/install-age.sh` after checking the release against its Sigsum transparency log.
- **Where secrets go.** The Cloudflare secrets reach only the *Collect Cloudflare traffic* step and the Google settings only the *Collect Google Search Console* step. The `days` input reaches scripts only as an environment variable.
- **What leaves Cloudflare.** Fixed queries return totals, plus a day and a count for each crawler-like visitor-day. The crawler-behaviour check runs inside Cloudflare's SQL, so visitor identifiers never reach the runner.
- **What the report may contain.** Numbers, known page paths (anything else becomes "other"), and bounded, HTML-escaped text such as Google search queries. It never contains account IDs, tokens, dataset names, visitor identifiers or event timestamps. Its Content-Security-Policy blocks every network request.
- **Encryption.** The report is encrypted to the public key in `.github/site-report-recipients.txt`, and the job refuses to run until that file holds a valid age key. Unencrypted data exists only on the runner, which GitHub discards after the job.

Repository settings that go with it: Actions may use only GitHub-owned actions and must pin them to full SHAs, and the *Basic* ruleset (no branch deletion, no force-push) targets the default branch.

### One-time setup

1. **Cloudflare token.** In the Cloudflare dashboard, open *My Profile → API Tokens → Create Token → Custom token*. Give it one permission, *Account → Account Analytics → Read*, limited to the OmaPicks account, with an expiry date about a year out. Then store it and the account ID:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --env site-report
   gh secret set CLOUDFLARE_ACCOUNT_ID --env site-report
   ```

   `gh` prompts for each value and never echoes it.

2. **Report key.** On your machine, run `sudo pacman -S age` and then `npm run report:keygen`. It asks for a passphrase and saves the private key, encrypted with that passphrase, to `~/.config/omapicks/site-report-key.age`. It also writes the public key to `.github/site-report-recipients.txt` and checks a round trip. Commit that file to `main`. Copy the key file to a second place (a USB stick or cloud storage is fine because the file is encrypted) and keep the passphrase in your password manager.

3. **Google Search Console (optional).** No Google key is stored. GitHub's short-lived identity token is exchanged for a ten-minute, read-only token through Workload Identity Federation, and Google accepts the token only from this repository's `site-report.yml` on `main` in the `site-report` environment. In [Google Cloud Shell](https://shell.cloud.google.com), with a project ID of your choice (it must be globally unique):

   ```sh
   PROJECT_ID=omapicks-report
   gcloud projects create "$PROJECT_ID" && gcloud config set project "$PROJECT_ID"
   gcloud services enable searchconsole.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com
   gcloud iam service-accounts create omapicks-report --display-name="OmaPicks site report (read-only Search Console)"
   sleep 120   # a new project's Owner role takes a moment to reach the pool API
   gcloud iam workload-identity-pools create github-actions --location=global --display-name="GitHub Actions"
   gcloud iam workload-identity-pools providers create-oidc omapicks-report \
     --location=global --workload-identity-pool=github-actions \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref" \
     --attribute-condition="assertion.repository_id == '1353362821' && assertion.repository_owner_id == '12031800' && assertion.ref == 'refs/heads/main' && assertion.environment == 'site-report' && assertion.workflow_ref.startsWith('BVisagie/omapicks/.github/workflows/site-report.yml@')"
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding "omapicks-report@$PROJECT_ID.iam.gserviceaccount.com" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1353362821"
   echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/omapicks-report"
   ```

   If the pool step still reports `PERMISSION_DENIED`, wait a few minutes and rerun from that line, not from the top, because the project and service account already exist. The final `echo` prints its line even when an earlier step failed.

   The numbers are this repository's and its owner's numeric GitHub IDs, which, unlike names, cannot be reclaimed by someone else. Give the service account no project roles. In Search Console, open *Settings → Users and permissions*, add `omapicks-report@<project-id>.iam.gserviceaccount.com` as a **Restricted** user, and then store the three settings:

   ```sh
   gh secret set GOOGLE_WORKLOAD_IDENTITY_PROVIDER --env site-report   # the line echoed above
   gh secret set GOOGLE_SERVICE_ACCOUNT --env site-report              # omapicks-report@<project-id>.iam.gserviceaccount.com
   gh secret set GOOGLE_SEARCH_CONSOLE_PROPERTY --env site-report      # sc-domain:omapicks.com, or the exact URL-prefix property
   ```

   These values are identifiers rather than credentials. Storing them as secrets keeps them out of logs.

4. **Optional notification.** For an email when any run finishes, not only a failed one, turn off *Only notify for failed workflows* under *GitHub Settings → Notifications → Actions*.

Each source is optional. A section whose settings are missing shows "not configured" and the rest of the report still builds.

### Reading a report

`npm run report:open` downloads the latest completed run's encrypted file with your `gh` login and keeps it in `~/Documents/omapicks-reports/` (or `$OMAPICKS_REPORT_ARCHIVE`). It then asks for the passphrase, decrypts into `$XDG_RUNTIME_DIR`, which is memory-backed and cleared at logout, and opens the HTML. Use `--run <id>` for a specific run, `--file <path>` for an archived file, and `--no-open` to print the path instead. The archive is encrypted, so it can live in any backup.

`npm run report` builds the same report locally into `tmp/site-report/`, using Cloudflare if `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. Search Console is collected only by the workflow, because it relies on GitHub's identity token. `npm run traffic` prints a quick terminal summary of recent traffic.

### Keeping the key safe

- **After reinstalling your machine:** install `age` and `gh`, run `gh auth login`, and copy the key file back to `~/.config/omapicks/site-report-key.age` (or point `OMAPICKS_REPORT_KEY` at it).
- **If the key or passphrase is lost or may be exposed:** move the old key file aside, run `npm run report:keygen`, and commit the new public key. Old reports stay readable only with the old key, and their artifacts expire after 30 days. Rerunning the workflow regenerates any period within the last 90 days of traffic and 16 months of search data.

### If a credential leaks

- **Cloudflare token.** It can read only this account's analytics. Revoke it under *My Profile → API Tokens*, create a new one, and run `gh secret set CLOUDFLARE_API_TOKEN --env site-report` again.
- **Google.** Nothing is stored to leak. To cut access, remove the service account from Search Console's users, or run `gcloud iam workload-identity-pools providers disable omapicks-report --location=global --workload-identity-pool=github-actions`.
- **Report key.** Make a new key as above and treat archived reports as readable by whoever holds the old one.

### Bot filtering and its pinned inputs

The Worker (`functions/measure.mjs`) counts a page view as a person only if all of these hold:
- the user-agent matches no pattern in the crawler list;
- the request is not a prefetch;
- it carries a browser's page-load headers (`Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`, `Accept-Language`);
- it does not come from a large cloud provider's network (`functions/cloud-networks.mjs`).

Anything else is stored with its reason and no visitor identifier, and only one in ten is kept, weighted ×10. Version 1 events from before this change carry no reason; the report labels them and marks the date the new filter went live.

- **Updating the crawler list.** `functions/vendor/isbot-patterns.mjs` holds isbot's `src/patterns.json`, byte for byte, between its BEGIN and END markers. To update it:
  1. Pick a new isbot release tag and resolve the tag to a commit.
  2. Download `src/patterns.json` at that commit and check that the published npm package's `list` matches it.
  3. Replace the text between the markers.
  4. Update `ISBOT_VERSION`, `ISBOT_COMMIT` and `ISBOT_PATTERNS_SHA256`.

  `test/measure.test.mjs` fails if the embedded text and the pinned hash disagree.
- **Updating the pinned age release.** To move to a new release:
  1. Download the new `age-<version>-linux-amd64.tar.gz` and its `.proof`.
  2. Verify them with `sigsum-verify -k <keys> -P sigsum-generic-2025-1 <proof> < <tarball>`. The keys are the two `ssh-ed25519` lines in that tag's `SIGSUM.md`, and `sigsum-verify` installs with `go install sigsum.org/sigsum-go/cmd/sigsum-verify@v0.13.1`.
  3. Update `AGE_VERSION` and `AGE_SHA256` in `scripts/install-age.sh`.

## Deployment and rollout

The repository keeps its existing Cloudflare Workers Git integration and `wrangler.toml`. This PR does not change Cloudflare account settings, production branch configuration, deployment credentials or GitHub branch rules. No second deployment workflow is added.

Before treating the merged state as fully operational, verify these external settings and the first runs:

1. The production branch is `main`, and Cloudflare builds the same commit that passed the intended validation. PR previews must not replace production. Cloudflare's production build command should include the required validation (at least `npm run check`), or its deployment policy must explicitly gate the matching SHA on CI. A Git integration that deploys immediately on every human push is not made dependent on CI merely by adding this workflow.
2. A validated bot data push triggers the existing Cloudflare integration. GitHub's suppression of downstream Actions does not establish how an external Git integration behaves; verify the first actual deployment and its commit SHA. If bot pushes are ignored, configure that integration or deliberately add one authenticated deployment path after review.
3. The default-branch rules permit the narrowly scoped data publisher to push, and the intended PR checks are required for human changes. If rules require all changes through PRs, this direct-data publication design needs an explicit compatible exception or a deliberate switch to data PRs. Do not weaken rules silently.
4. Run **Review evidence** on `main`, inspect the preserved evidence and candidate checks, then run **Update availability**. Confirm that its diff contains only availability and that the deployed observation updates without changing rankings or history. Run **Publish recommendations** with `republish` only when a deliberate same-week publication is intended.
5. Confirm the Tuesday observation produces canonical state, Thursday remains report-only, and the next Tuesday restores a compatible state or explains a deliberate baseline reset. Watch for feed/source failures and stale snapshot/availability notices.

If a publisher fails, inspect its summary and archived evidence and start a fresh run after correcting the cause. Do not force-push or manually merge an old data artifact. For a bad published observation, revert the specific data commit through the normal reviewed path and investigate before resuming its schedule. For a behavior regression, revert the relevant code change and validate the retained historical snapshots before redeploying.
