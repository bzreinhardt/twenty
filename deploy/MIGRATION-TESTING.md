# Frozen-baseline migration rehearsals

For hot-reloading frontend/backend development against a saved starting
database, see [LOCAL-DEV.md](LOCAL-DEV.md). Use this image rehearsal for final
migration checks; it complements the faster source-editing loop.

Use `bash deploy/migration-test.sh` locally and in CI. Each `run` restores the
same frozen database into new, labeled Docker resources. It never reads a server
`.env`, connects to `twenty-dev`, or reuses Redis, storage, or a migration ledger
from a previous attempt. Docker must use a local Unix socket. Cloud hosts and
remote Docker endpoints are refused. A refused environment guard is a stop.

## Create a baseline once

A fixture is synthetic and reserved for CI, clean-initialization checks, and
shareable screenshots:

```bash
bash deploy/migration-test.sh freeze \
  --baseline deploy/.migration-tests/baselines/release-fixture \
  --source-sha "$(jq -r .source_sha deploy/migration-baseline.json)" \
  --image "$(jq -r .image deploy/migration-baseline.json)"
```

`deploy/migration-baseline.json` pins a supported starting release by image digest
and full source revision. Its initial digest comes from the linked build run;
that older image predates revision labels. Subsequent images must have matching
OCI revision labels. Freeze runs setup, all fast/slow instance commands, the
existing `workspace:seed:dev` seeder, upgrade, and explicit status checks. The full synthetic seeder is intentional: the
pinned release's `--light` truncates foreign-key parents and logs a constraint
failure while exiting zero. Freeze rejects logged seeder errors and verifies
existing fixture records before accepting the baseline.

For local feature work and final CRM compatibility checks, always use an
already verified, scrubbed mirror:

```bash
bash deploy/migration-test.sh freeze \
  --baseline deploy/.migration-tests/baselines/release-mirror \
  --source-sha <source-revision-from-backup-release-record> \
  --dump /private/path/to/verified-mirror.dump
```

Obtain it through `deploy/devdata-publish.sh` and the approved read-only backup
configuration. **The mirror's legacy `git_sha` identifies the scrubber checkout,
not necessarily the deployed source.** Supply the source revision independently
from the backup's release provenance. Never guess it. Import verifies the existing
scrub assertions before any application process starts. Network isolation and
runtime settings disable outbound access, cron registration, email delivery,
provider connections, and logic functions. A mirror still contains private CRM
records: never upload it, its logs, or screenshots.

The baseline manifest records the dump checksum, source and image, PostgreSQL
version, extensions, database settings and the supported local role contract.
It preserves every application schema, metadata and both migration histories.
Database ownership/grants are deliberately normalized to the local developer
`postgres` role; custom database role/permission migrations need a separately
reviewed fixture and are outside this harness's current contract. Refresh under a
new baseline path in a reviewed change when production advances. Existing
baseline paths cannot be overwritten.

## Run, inspect, reset, rerun

```bash
# Builds current source, using ordinary Docker dependency/build layers.
bash deploy/migration-test.sh run \
  --baseline deploy/.migration-tests/baselines/release-fixture --build

# Test the actual release image; --preview checks frontend runtime configuration.
bash deploy/migration-test.sh run \
  --baseline deploy/.migration-tests/baselines/release-fixture \
  --image ghcr.io/speculativetechnologies/twenty@sha256:<digest> \
  --preview --port 3015 --keep --logs deploy/.migration-tests/review

# Stop/remove only this retained attempt. The frozen baseline is untouched.
bash deploy/migration-test.sh reset --logs deploy/.migration-tests/review
```

After editing an unreleased migration, run again: a new clone guarantees the
edited command cannot be skipped because an earlier attempt recorded success.
Never rewrite released commands. Add a forward migration instead.

`--assert-sql path.sql` runs branch-specific assertions after application smoke
checks. Use `DO ... RAISE EXCEPTION` for missing records, incorrect transforms,
edge cases and broken relationships. Never treat a SELECT printing `false` as
an assertion. Permission changes also need role-specific API/UI checks; the
built-in smoke test covers an admin API key and rejection without authentication.
Fixtures exercise writes followed by a fresh API read; mirrors use existing
records without logging response bodies. Browser persistence and affected UI
paths remain explicit reviewer/agent checks.

The actual sequence is `run-instance-commands --force --include-slow`, `upgrade`,
`cache:flush`, API/worker startup, queue drain, `upgrade:status`, `upgrade --dry-run`,
and API/metadata/persistence smoke checks. The status must name an up-to-date
instance and zero behind/failed workspaces. Fresh Redis must contain no pending
or failed jobs. Queue drain has a configurable `--timeout` (300 seconds default).
Automatic entrypoint migrations are disabled, so API and worker cannot race the
one-off migrator. Separate attempt resources also prevent concurrent branches
from sharing migration/cache state.

Every failure exits nonzero, retains private phase and service logs, and removes
the disposable stack unless `--keep` was requested. `result.json` and
`timings.json` provide machine-readable evidence. Check phase logs locally;
never upload raw mirror diagnostics. CI uploads synthetic verdict/timing
records and redacted fixture failure logs and runs the migration command directly, outside Nx result caching.

The synthetic fixture does not contain this fork's seven custom objects. Before
promoting schema, metadata, view, search or permission changes, repeat against a
verified mirror as required by `LLM-LOCAL-DEV.md`. Assess long backfills and locks
with representative volume/concurrent traffic. Restore time is measured; no
filesystem snapshot mechanism or new hosting platform is introduced.

`report --logs <attempt> --output <directory>` exports token-redacted diagnostics
only when the attempt is recorded as synthetic. Mirror and unknown datasets are
refused before any export is written.
