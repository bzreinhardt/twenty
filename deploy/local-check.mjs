import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveBase } from '../.github/scripts/lint-changed.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export const checkEnvironment = (environment, base) => {
  const result = {
    ...environment,
    NX_LOAD_DOT_ENV_FILES: 'false',
    TWENTY_LINT_BASE: base,
  };
  // Nx sets FORCE_COLOR on child commands. When NO_COLOR is also inherited,
  // Node emits a warning in Prettier's sync workers and barrel generation hangs.
  // Remove the conflicting setting only for this invocation, not the shell.
  delete result.NO_COLOR;
  return result;
};

export const checkArguments = (parallel) => {
  if (!/^[1-4]$/.test(parallel)) {
    throw new Error('--parallel must be 1, 2, 3 or 4 (default: 2)');
  }
  return [
    'run-many',
    '-t',
    'lint:diff-with-main',
    'typecheck',
    '-p',
    'twenty-server',
    'twenty-front',
    `--parallel=${parallel}`,
    '--outputStyle=static',
  ];
};

const main = () => {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      parallel: { type: 'string', default: '2' },
      plan: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'Usage: yarn check:local [--plan] [--base origin/main] [--parallel 1..4]',
    );
    console.log(
      'Runs frontend and server changed-file lint and full typechecks in one Nx graph.',
    );
    console.log(
      'Focused tests, UI checks and required migration rehearsals remain separate.',
    );
    return;
  }
  const arguments_ = checkArguments(values.parallel);
  const base = resolveBase(ROOT, values.base || process.env.TWENTY_LINT_BASE);
  console.log(`[local-check] Lint base: ${base}`);
  console.log(`[local-check] nx ${arguments_.join(' ')}`);
  console.log(
    '[local-check] Focused tests, UI checks and migration rehearsals are separate.',
  );
  if (values.plan) return;

  const executable = path.join(ROOT, 'node_modules', '.bin', 'nx');
  if (!existsSync(executable)) {
    throw new Error('Run yarn install --immutable in this worktree first');
  }
  const started = performance.now();
  // A single task graph schedules shared builds once and retains Nx caching.
  // Avoid loading an application's .env for these database-free checks.
  const result = spawnSync(executable, arguments_, {
    cwd: ROOT,
    stdio: 'inherit',
    env: checkEnvironment(process.env, base),
  });
  if (result.error) throw result.error;
  process.exitCode = result.status || (result.signal ? 1 : 0);
  console.log(
    `[local-check] ${process.exitCode === 0 ? 'PASS' : 'FAIL'} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`[local-check] ${error.message}`);
    process.exitCode = 1;
  }
}
