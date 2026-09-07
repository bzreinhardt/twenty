# Instructions for coding agents on a developer machine

Read this before changing anything in this repository. It describes the whole
modification pipeline, from getting a dataset to promoting a change to
production, and the boundaries that are not yours to cross.

Human context is in [TEAM-WORKFLOW.md](TEAM-WORKFLOW.md) and
[DEVELOPMENT.md](DEVELOPMENT.md). This file is the operational version.

## Hard rules

1. Work only in a developer checkout with developer-owned Postgres, Redis, and
   storage. Never use a cloud VM as a development environment.
2. Never point local development at cloud services, secrets, or environment
   files.
3. Never push to `main`, and never deploy. Promotion is the production owner's
   action.
4. Never repair schema drift with manual SQL. Schema changes travel as
   committed instance commands and workspace upgrades.
5. Never upload a mirror dump, or rows from one, to a commit, pull request,
   issue, log, or hosted artifact. See "Handling mirror data" below.
6. If a command refuses to run because of an environment guard, stop and report
   it. Do not work around the guard.

## Step 0: confirm where you are

For an isolated worktree with source hot reload and a saved starting database,
follow [LOCAL-DEV.md](LOCAL-DEV.md). That supervisor supplies its own local
connections; do not run the standard setup/reset commands below against its
database. Keep the same dataset choices and verification requirements.

```bash
pwd
git status --short --branch
docker compose -f packages/twenty-docker/docker-compose.dev.yml ps
```

You are in the standard developer environment when the checkout is on a
developer-owned machine and the `twenty-dev` Docker services are running. If
they are not running:

```bash
bash packages/twenty-utils/setup-dev-env.sh --docker
cp deploy/git-hooks/post-merge .git/hooks/post-merge && chmod +x .git/hooks/post-merge
```

Then confirm the schema matches the checked-out commit:

```bash
bash deploy/local-schema.sh check
```

## Step 1: always develop against the mirror

Use a verified development mirror for **all local feature work and user
acceptance testing**, including UI, copy, and frontend state. The CRM has
custom fields, layouts, views, and seven custom objects that a synthetic
fixture cannot exercise. Check the running dataset before investigating a bug
or handing Ben a URL. Do not silently substitute a fixture when mirror access
is unavailable; report what is missing.

For isolated worktrees use the saved mirror through `deploy/LOCAL-DEV.md`.
For the standard developer checkout:

```bash
bash deploy/local-data.sh mirror
```

Takes a few minutes. It builds a scrubbed mirror locally from the latest
available nightly production backup, replaces the local database, verifies the
scrub, and runs `local-schema.sh sync`. Access to the backup is read-only and
comes from the developer's ignored local configuration. Sign in at
`http://localhost:3001` with any account it prints, password `devmirror`.

Check what is installed at any time with `bash deploy/local-data.sh verify`.

## Step 2: make the change

Follow `CLAUDE.md` for code conventions. For schema changes specifically:

```bash
# after editing entity files
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
npx nx run twenty-server:database:migrate

# after editing the GraphQL schema
npx nx run twenty-front:graphql:generate
```

Commit the generated instance command in the same commit as the entity change.
Never edit the `up` or `down` of an instance command that is already on `main`.

## Step 3: verify locally

Run all of these. Report the actual output; do not summarize a failure as a
pass.

```bash
npx nx lint:diff-with-main twenty-server
npx nx lint:diff-with-main twenty-front
npx nx typecheck twenty-server
npx nx typecheck twenty-front
cd packages/twenty-server && npx jest <pattern>
```

Schema changes need both migration paths tested, because they fail differently:

```bash
# 1. upgrade path: an existing database moving to your commit
bash deploy/local-schema.sh sync

# 2. clean path: a database built from nothing at your commit
bash packages/twenty-utils/setup-dev-env.sh --docker --reset
bash deploy/local-schema.sh check
```

The reset wipes local data. Reinstall the dataset afterwards and confirm the
upgrade path again against mirrored data:

```bash
bash deploy/local-data.sh mirror
```

Then exercise the change in the running app (`yarn start`, then
`http://localhost:3001`). For a schema change, confirm the affected records
still load, are editable, and survive a refresh.

## Step 4: open the pull request

```bash
git switch -c yourname/short-description
git push -u origin HEAD
gh pr create --base main
```

State what changed and why, how it was tested, whether it touches the database,
environment variables, permissions, integrations or jobs, and how to roll back.
Attach screenshots for visible UI changes.

Use a separate synthetic fixture session for those screenshots, then resume
and verify the mirror before handing over the local URL. Fixtures also remain
required for CI and clean-initialization checks. Take screenshots against the
fixture, not the mirror. Mirror screenshots
contain real names, companies, and notes, and a pull request is a permanent
public-to-the-team record.

Wait for `ci-fork-status-check` and review. Do not merge your own PR without
review. `deploy/**`, `packages/twenty-server/src/database/**`, auth, roles,
permissions, secrets, integrations, and background jobs require the production
owner's review.

## Step 5 and 6: staging and production

Promotion runs through GitHub Actions against the cloud environments and is the
production owner's action. Do not initiate staging or production deployment on
your own initiative, and do not operate the cloud VMs directly.

The sequence, for reference when reporting readiness:

1. After required CI and review, an authorized maintainer merges the PR to
   `main`.
2. At the scheduled release window, typically at the end of the day, select the
   exact full SHA on `main` and wait for CI to publish its image.
3. Run **Deploy to staging** for that exact SHA and wait for the cloud
   deployment result.
4. Exercise the changed behavior and the normal CRM smoke-test paths at
   `https://crm-staging.spec.tech`, then record an affirmative pass or fail.
5. If staging passes and the production owner is available to monitor the
   release, run **Deploy to production** for the exact SHA staging ran and
   obtain the production approval. Otherwise wait for the next supported
   release window.
6. If staging fails, do not promote it. Revert or fix the issue through another
   reviewed PR and test the new `main` SHA on staging.
7. Follow the private
   [`crm-ops` cloud runbook](https://github.com/SpeculativeTechnologies/crm-ops/blob/main/deploy/CLOUD-OPS.md)
   for operational checks, backup requirements, and rollback.

Pre-merge staging is reserved for unusually risky changes that need cloud
validation before review can finish. Such a PR needs the `needs-staging` label
to publish an image. This does not replace CI, review, or the normal release
train from `main`.

Your job ends at a reviewed PR plus a clear statement of what needs verifying
on staging. The production owner owns merging and promotion.

## Handling mirror data

A mirror has no third-party mailbox content, but it is still the real CRM:
actual people, companies, and internal notes about them.

- Do not paste mirror rows into commits, PR descriptions, issues, comments, or
  commit messages.
- Do not upload a dump or query results anywhere, including to a hosted
  artifact, gist, or paste service.
- Do not include real records in test fixtures. Test data goes in the seeder.
- Prefer aggregate queries when investigating. `count(*)` and `group by` answer
  most questions without reading anyone's record.
- When you are done with the machine, or before it changes hands:

  ```bash
  bash deploy/local-data.sh reset --yes
  ```

If you are asked to share evidence that involves real records, share the query
and the counts, not the rows.

## When something fails

| Symptom | Cause | Action |
|---|---|---|
| Blank screen, "Cannot return null for non-nullable field" | schema behind the checkout | `bash deploy/local-schema.sh sync` |
| `local-schema.sh` refuses to run | not the guarded `twenty-dev` target | stop, report; do not bypass |
| `mirror` reports "not a verified mirror" | the dump was not produced by `devdata-publish.sh` | stop and report; the local database was already wiped |
| `mirror` cannot read the nightly backup | missing or expired local R2 read credentials | obtain the approved read-only configuration, or ask for a verified mirror dump and use `mirror --from-file` |
| Custom object page is blank | the object has no view rows | create a view for it, then `npx nx run twenty-server:command -- cache:flat-cache-invalidate --metadataName view` |
| Upgrade status reports "behind" or "failed" | a workspace upgrade did not apply | report the exact output; do not patch the database by hand |

Report failures with the command and its real output. A silently skipped
verification step is worse than a failed one.

## Keep the development loop short

- Confirm worktree, branch, dataset, URL and running supervisor once. Keep a
  private handoff under `deploy/.local-dev/` with that state and check results;
  never put credentials or mirror rows in user-facing output.
- Reuse the frozen mirror and running source watchers. Ordinary source edits
  need hot reload, not a Docker image build, data refresh, or deployment.
  Restore the baseline when testing an edited migration; keep it fixed during
  that repair. Preserve any local user edits before replacing the database.
- Inspect metadata relationships before assuming a missing control is a browser
  timing problem. Old workspaces may retain legacy standard identifiers;
  fixture identifiers and default layouts are not evidence for their shape.
- Save a reusable browser check early. Exercise the actual user action on the
  mirror: add two contacts, reload, remove one, and verify the other and primary
  contact survive. Keep mirror screenshots, responses and names out of output.
- Run focused behavior tests and required diff lint/typechecks while iterating.
  Format changed source with `oxfmt`; also lint new, uncommitted files directly,
  because `lint:diff-with-main` only considers committed changes. Use the
  migration formatter convention for new upgrade commands, which are excluded
  from the general formatter to protect committed commands.
  For built-in layout changes, also run `standard-metadata-label-catalog.spec.ts`
  and the affected layout snapshot test. Plain-string widget titles require a
  matching literal in the widget-title catalog before Lingui can extract them.
  Batch independent reads/checks; keep database mutations and source builds
  sequential. Run the final image rehearsals and exact-commit CI after the
  coherent change is ready. Repeat checks only for changed code or new failures.
- Read `timings.json` and the named phase log when startup is slow. Report the
  phase being checked instead of repeatedly polling an unchanged browser.
- Finish shared-package builds and typechecks before browser acceptance tests;
  replacing shared bundles during a browser run can trigger a full reload.
- Before returning a local testing link, confirm the mirror is running, sign-in
  works, the changed control is visible, and the requested interaction persists.

## Exact-commit follow-through

Follow [MIGRATION-TESTING.md](MIGRATION-TESTING.md) for isolated frozen-baseline
rehearsals and [PIPELINE-AUDIT.md](PIPELINE-AUDIT.md) for the release graph.
The existing `twenty-dev` guard remains unchanged. For migration work, run the
branch against a frozen mirror as well as a fixture and clean initialization.
Do not use a previously upgraded database to test an edited unreleased command.

After each coherent change, run local checks, commit, push the feature branch,
and run `bash deploy/ci-follow.sh <full-source-sha>`. It waits for that commit's
runs, retrieves failed-job logs into an ignored private directory, and fails on
an absent, failed, canceled or timed-out required run. Diagnose those logs and
fix branch defects before pushing another commit. Repeat local verification for
the fix and follow the new exact SHA. Do not stop at a successful push.

Limit a repair cycle to two diagnosed correction attempts before reporting the
remaining blocker; `CI_FOLLOW_TIMEOUT_MINUTES` controls each watch (40 default).
Do not retry code/data failures unchanged. Retry an infrastructure failure at
most once and only with log evidence that it was transient. Never weaken a
check or dispatch a deployment to find out whether a local migration works.
The existing PR checks agent remains available; do not race its branch edits.

When staging deployment is explicitly authorized, follow its correlated cloud
run, inspect rehearsal/migration/API/worker logs through the approved operations
workflow, and test affected API/UI paths on that recorded deployment. Otherwise
finish with the exact staging blocker and owner handoff. Promotion permission
is not implied by pushing a branch. Keep private CRM rows and raw mirror logs
out of GitHub and user-facing evidence.

The handoff must name source SHA, PR, digest (or why unavailable), check results,
migration status, baseline checksum, behaviors tested, timings, staging URL and
deployment ID (or “not deployed”), and limitations. Production must consume the
same verified digest and still requires its normal approval. Installing the
paired `crm-ops` host-script contract is an owner operation, never a local-test
side effect.
