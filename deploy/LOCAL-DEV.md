# Daily local development

Use this when you want to edit the frontend or backend repeatedly without
building a release image or deploying. Each worktree gets its own Postgres,
Redis, local uploads, ports and signing secret. Your normal `twenty-dev`
database and other worktrees are left alone.

Prerequisites: local Docker, Python 3, Node 24 and this worktree's dependencies
(`yarn install --immutable`). Run the commands from the worktree you are editing.

## Choose the starting database once

A **saved starting database**, called a baseline by the migration tool, is a
snapshot of both the records and schema before your change. Resetting restores
that exact snapshot, including the record of which migrations already ran.

Always use a **mirror** for local development and user testing, including UI
changes. It is a verified, scrubbed copy of the CRM with this fork's custom
layouts, fields, views and seven custom objects. It still contains confidential
records. Application runtime variables are removed along with credentials;
configure any test integration separately with developer-owned values. Version
1 mirrors must be rebuilt with the current publisher before use.

Synthetic **fixtures** are reserved for CI, clean-initialization checks, and
shareable screenshots. The local launcher requires an explicit `--fixture`
flag for those sessions, including when resuming one. Never hand a fixture URL
to the user as the CRM test environment. Return to the mirror after screenshots.

For a mirror, obtain a verified dump through the approved developer data
workflow in [DEVELOPMENT.md](DEVELOPMENT.md). Freeze it using the full source
revision that actually produced the backup, not the scrubber's checkout SHA:

```bash
bash deploy/migration-test.sh freeze \
  --baseline deploy/.migration-tests/baselines/mirror \
  --source-sha <backup-source-sha> --dump <verified-mirror.dump>
```

Verification runs before application code touches the restored mirror. A raw
production dump is not accepted. If approved backup access or a verified dump
is unavailable, report the missing access; do not substitute synthetic data for
local user testing. Refresh into a **new** snapshot directory when needed;
keep the snapshot fixed while iterating on a migration.

## Start, edit, repeat

```bash
bash deploy/local-dev.sh start \
  --baseline deploy/.migration-tests/baselines/mirror
```

Sign in with a mirrored CRM account and the local password `devmirror`. The
banner must say `local mirror`. These local changes do not affect production.

The first start restores the snapshot, builds the server and its dependencies,
and applies the current branch's migrations. It then starts Vite, one Nest
compiler watcher, and restarting API and worker processes. It prints the local
URL. Ports are picked automatically and remembered; optionally specify
`--port 3101 --api-port 3100`. An occupied port causes an error, never a silently
changed URL or a connection to another developer's service.

- Save a frontend edit: Vite updates the browser through hot module reload.
- Save backend code: the compiler rebuilds it and the API and worker restart.
- Edit records in the app: changes stay in this worktree's database across
  source reloads and subsequent starts.
- Edit an entity or migration: generate the required instance command, then
  use the reset workflow below. Reloading code does not replay migrations.
- Edit a built shared package or dependencies: stop and start again to rebuild
  dependencies. Frontend imports of source files reload directly.

Ctrl-C stops the watchers and their children while keeping the database
containers running. When testing is finished, also stop those containers using
the shutdown procedure below.
Resume with `yarn dev:local` or `bash deploy/local-dev.sh start`; the selected
snapshot and ports are remembered. Do not run the ordinary `yarn start` in
parallel in the same worktree: it uses different connection settings and shares
the server's build output.

Compilation and application logs are private files under
`deploy/.local-dev/<resource-name>/`. The tool prints the directory. Look at
`compiler.log`, `api.log`, `worker.log`, or `front.log` when a change fails.
Mirror logs can contain CRM records; do not publish them or mirror screenshots.

## Reset and replay a database change

Generate commands against this environment through its wrapper, after stopping
the watchers. The ordinary Nx database commands read the standard developer
`.env`, so they are not the commands to use for this isolated database:

```bash
bash deploy/local-dev.sh command -- generate:instance-command --name <name> --type fast
```

The wrapper also supports other server CLI commands, such as `upgrade:status`,
and keeps their output in the private diagnostics directory. It uses this
worktree's source and guarded local connections.

Stop the watchers with Ctrl-C, then run:

```bash
yarn dev:reset
# equivalent: bash deploy/local-dev.sh reset
```

This removes only this worktree's database, Redis queues and uploaded files,
restores the saved snapshot, builds the edited source, reruns migrations, and
starts the watchers again. Local record edits are discarded; the saved
snapshot and your source edits are retained. The command refuses to reset while
the watchers are running. A failed restore or migration requires a reset before
the next start, so a partially upgraded database is not silently reused.

To switch to a mirror or a fresh snapshot:

```bash
bash deploy/local-dev.sh reset --baseline <new-snapshot-directory>
```

For a synthetic screenshot session only, create a fixture with the baseline
commands in [MIGRATION-TESTING.md](MIGRATION-TESTING.md), then use
`reset --baseline <fixture-directory> --fixture`. Keep its records out of the
mirror, and switch back with `reset --baseline <mirror-directory>` before
handing off local testing. Preserve local user edits before any reset.

Use `bash deploy/local-dev.sh status` to see the dataset, checksum and URL.

## Finish local testing

Stop this task's source watchers and Docker containers when local testing is
finished, including after user acceptance. Leave them running only when the
user explicitly wants continued local testing. Waiting for CI, review, merge or
deployment does not require a running local environment.

For an isolated worktree:

1. Stop its supervisor with Ctrl-C in the session that started it. If that
   session is unavailable, verify the supervisor's process ID and worktree
   before sending SIGTERM; never use a broad process-name kill.
2. Run `bash deploy/local-dev.sh status` from that worktree to check the local
   environment guard and confirm the supervisor stopped.
3. Identify containers by the exact worktree ownership label:

   ```bash
   docker ps --filter "label=tech.spec.local-dev.worktree=$(pwd -P)" \
     --format '{{.ID}} {{.Names}}'
   ```

   Stop the verified container IDs with `docker stop <container-id> ...`, then
   repeat the filtered listing and confirm no containers remain running.
   Do not print `state.json`, which contains a signing secret.

For the standard `twenty-dev` Compose stack, stop the task's application
processes, confirm the stack is not in use by another task, then run:

```bash
docker compose -f packages/twenty-docker/docker-compose.dev.yml stop
docker compose -f packages/twenty-docker/docker-compose.dev.yml ps --status running
```

Record shutdown in the handoff. Preserve containers, volumes, uploads and the
saved snapshot so the next start can resume local edits. Do not stop unrelated
containers or quit Docker Desktop globally. If Docker is unavailable, report
that shutdown could not be verified; do not start it just for cleanup.

`bash deploy/local-dev.sh down` is destructive: it removes this worktree's
database, Redis and local uploads, retaining only the saved snapshot and private
diagnostics. Use it only when discarding local data is requested, not for routine
shutdown. Likewise, do not use volume deletion or Docker pruning for cleanup.

## Boundaries and release checks

For source verification, run `yarn check:local` in this worktree. It groups the
frontend/server changed-file lint and full typechecks into one Nx invocation
with shared dependency builds and two concurrent tasks. Use `--parallel 1` if
another worktree is compiling. No database reset or image build is needed for
these checks. See [LLM-LOCAL-DEV.md](LLM-LOCAL-DEV.md) for the remaining focused
tests, dataset requirements and migration checks.

The supervisor supplies a fresh environment and disables dotenv loading in Nx,
Vite, Nest, both TypeORM sources and frontend runtime configuration. Existing
shell variables or `.env` files cannot redirect this workflow to other services.
The API, frontend, Postgres and Redis bind only to loopback. Cloud configuration
stored in the database is disabled, email uses the logger, and mailbox/calendar
providers, cron registration and logic-function execution are disabled.

Source processes run on the developer's host and **do have network access**.
Do not connect real integrations or add cloud credentials to this workflow.
Use the offline image rehearsal for stronger network isolation and final
validation. Startup waits for migration jobs and upgrade status, but this
development mode does not certify a release artifact or the intended data
transformation just because the UI opens.

Before review, follow [LLM-LOCAL-DEV.md](LLM-LOCAL-DEV.md) for focused tests,
lint/typechecks, clean initialization and mirror verification. Run the frozen
baseline image rehearsal in [MIGRATION-TESTING.md](MIGRATION-TESTING.md) for
migration changes. Staging remains the final check of the actual release image;
it is not needed for every frontend or database experiment.

## Faster feedback

Keep the mirror and source watchers running during active edits and testing;
stop them when testing is finished as described above. Refreshing data,
rebuilding a release image, and deploying are separate from the daily edit loop.
Run focused behavior tests and required diff lint/typechecks first; build and
rehearse the final image once the coherent change is ready. Consult private
`timings.json` and phase logs before retrying a slow command. Keep reusable
browser checks and the current branch/baseline/check status under the ignored
`deploy/.local-dev/` directory so the next session can continue without
rediscovering the environment. Never save mirror screenshots as test evidence.
