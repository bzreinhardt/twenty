import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { changedFiles, lintCommands, resolveBase } from './lint-changed.mjs';
import { checkArguments, checkEnvironment } from '../../deploy/local-check.mjs';

const fixture = (context) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'twenty-lint-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...arguments_) =>
    execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
  const write = (file, content = 'export const value = 1;\n') => {
    const destination = path.join(root, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  for (const name of [
    'unstaged',
    'staged',
    'deleted',
    'renamed',
    'committed',
  ]) {
    write(`packages/twenty-server/src/${name}.ts`);
  }
  write('.gitignore', 'node_modules/\n**/ignored.ts\n');
  git('add', '.');
  git('commit', '-qm', 'Fixture');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', base);
  git('switch', '-qc', 'feature');
  return { root, git, write, base };
};

test('includes committed, staged, unstaged, renamed and untracked sources, excluding deleted and ignored files', (context) => {
  const { root, git, write, base } = fixture(context);
  write(
    'packages/twenty-server/src/committed.ts',
    'export const committed = 2;\n',
  );
  git('add', '.');
  git('commit', '-qm', 'Branch change');
  write('packages/twenty-server/src/staged.ts', 'export const staged = 2;\n');
  git('add', '.');
  write(
    'packages/twenty-server/src/unstaged.ts',
    'export const unstaged = 2;\n',
  );
  rmSync(path.join(root, 'packages/twenty-server/src/deleted.ts'));
  renameSync(
    path.join(root, 'packages/twenty-server/src/renamed.ts'),
    path.join(root, 'packages/twenty-server/src/has spaces.ts'),
  );
  write('packages/twenty-server/src/untracked.tsx');
  write('packages/twenty-server/src/ignored.ts');
  write('packages/twenty-server/src/notes.md');
  write('packages/twenty-front/src/separate.ts');
  assert.deepEqual(changedFiles(root, 'twenty-server', base), [
    'src/committed.ts',
    'src/has spaces.ts',
    'src/staged.ts',
    'src/unstaged.ts',
    'src/untracked.tsx',
  ]);
  assert.deepEqual(changedFiles(root, 'twenty-front', base), [
    'src/separate.ts',
  ]);
});

test('uses the fetched main merge base without including changes made only on main', (context) => {
  const { root, git, write, base } = fixture(context);
  git('switch', '-q', 'main');
  write('packages/twenty-server/src/upstream.ts');
  git('add', '.');
  git('commit', '-qm', 'Upstream change');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('switch', '-q', 'feature');
  assert.equal(resolveBase(root), base);
  assert.deepEqual(changedFiles(root, 'twenty-server', resolveBase(root)), []);
});

test('prefers origin/main over stale local main and supports clones without origin', (context) => {
  const { root, git, write, base } = fixture(context);
  write('packages/twenty-server/src/fetched.ts');
  git('add', '.');
  git('commit', '-qm', 'Fetched revision');
  const fetched = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', fetched);
  assert.equal(resolveBase(root), fetched);
  assert.equal(resolveBase(root, 'main'), base);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.equal(resolveBase(root), base);
});

test('invalid bases and Git failures fail instead of claiming there are no changes', (context) => {
  const { root } = fixture(context);
  assert.throws(() => resolveBase(root, 'missing-branch'));
  assert.throws(() => changedFiles(root, 'twenty-server', 'missing-branch'));
  assert.throws(() => changedFiles(root, '../outside', 'HEAD'));
});

test('keeps special filenames as individual arguments and preserves type-aware lint in fix mode', () => {
  const files = ['src/has spaces.ts', 'src/$(touch unexpected).tsx'];
  const [lint, format] = lintCommands(files, false);
  assert.deepEqual(lint, [
    'oxlint',
    '--type-aware',
    '-c',
    '.oxlintrc.json',
    '--',
    ...files,
  ]);
  assert.deepEqual(format, ['oxfmt', '--check', '--', ...files]);
  assert.ok(lintCommands(files, true)[0].includes('--fix'));
  assert.ok(lintCommands(files, true)[0].includes('--type-aware'));
  assert.ok(!lintCommands(files, true)[1].includes('--check'));
});

test('retains all four required checks and bounds concurrency', () => {
  assert.deepEqual(checkArguments('2'), [
    'run-many',
    '-t',
    'lint:diff-with-main',
    'typecheck',
    '-p',
    'twenty-server',
    'twenty-front',
    '--parallel=2',
    '--outputStyle=static',
  ]);
  for (const value of ['0', '5', '-1', 'two', '2;echo unsafe']) {
    assert.throws(() => checkArguments(value));
  }
});

test('avoids conflicting Nx color settings without mutating the parent environment', () => {
  const environment = { NO_COLOR: '1', FORCE_COLOR: '1', PATH: '/test/bin' };
  assert.deepEqual(checkEnvironment(environment, 'base-sha'), {
    FORCE_COLOR: '1',
    PATH: '/test/bin',
    NX_LOAD_DOT_ENV_FILES: 'false',
    TWENTY_LINT_BASE: 'base-sha',
  });
  assert.equal(environment.NO_COLOR, '1');
});

test('plan needs no installed dependencies; execution invokes Nx once and propagates failure', (context) => {
  const { root, base } = fixture(context);
  mkdirSync(path.join(root, 'deploy'));
  mkdirSync(path.join(root, '.github/scripts'), { recursive: true });
  copyFileSync(
    new URL('../../deploy/local-check.mjs', import.meta.url),
    path.join(root, 'deploy/local-check.mjs'),
  );
  copyFileSync(
    new URL('./lint-changed.mjs', import.meta.url),
    path.join(root, '.github/scripts/lint-changed.mjs'),
  );
  const run = (...arguments_) =>
    spawnSync(process.execPath, ['deploy/local-check.mjs', ...arguments_], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TWENTY_LINT_BASE: 'origin/main' },
    });
  assert.equal(run('--plan').status, 0);
  assert.equal(run().status, 1);
  mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  writeFileSync(
    path.join(root, 'node_modules/.bin/nx'),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync('invocations.jsonl', JSON.stringify({ args: process.argv.slice(2), base: process.env.TWENTY_LINT_BASE, dotenv: process.env.NX_LOAD_DOT_ENV_FILES }) + '\\n');
process.exit(7);
`,
    { mode: 0o755 },
  );
  const result = run();
  assert.equal(result.status, 7);
  assert.match(result.stdout, /FAIL/);
  const calls = readFileSync(path.join(root, 'invocations.jsonl'), 'utf8')
    .trim()
    .split('\n');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]), {
    args: checkArguments('2'),
    base,
    dotenv: 'false',
  });
});
