import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const git = (root, arguments_) => {
  const result = spawnSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim());
  }
  return result.stdout;
};

export const resolveBase = (root, requestedBase) => {
  let base = requestedBase;
  if (!base) {
    const remote = spawnSync(
      'git',
      ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
      { cwd: root, stdio: 'ignore' },
    );
    base = remote.status === 0 ? 'refs/remotes/origin/main' : 'refs/heads/main';
  }
  // Resolve first so a bad base fails instead of reporting "No changed files".
  const revision = git(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${base}^{commit}`,
  ]).trim();
  return git(root, ['merge-base', revision, 'HEAD']).trim();
};

export const changedFiles = (root, project, base) => {
  if (!['twenty-front', 'twenty-server'].includes(project)) {
    throw new Error('Project must be twenty-front or twenty-server');
  }
  const projectRoot = `packages/${project}/`;
  // Comparing the merge base to the working tree includes staged and unstaged
  // edits. Untracked files need a separate query; NUL delimiters preserve spaces.
  const tracked = git(root, [
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=d',
    base,
    '--',
    `${projectRoot}src/`,
  ]);
  const untracked = git(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    `${projectRoot}src/`,
  ]);
  return [...new Set(`${tracked}${untracked}`.split('\0'))]
    .filter(
      (file) => /\.(ts|tsx)$/.test(file) && existsSync(path.join(root, file)),
    )
    .map((file) => file.slice(projectRoot.length))
    .sort();
};

export const lintCommands = (files, fix) => [
  [
    'oxlint',
    '--type-aware',
    ...(fix ? ['--fix'] : []),
    '-c',
    '.oxlintrc.json',
    '--',
    ...files,
  ],
  ['oxfmt', ...(fix ? [] : ['--check']), '--', ...files],
];

const main = () => {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      base: { type: 'string' },
      fix: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
    },
  });
  const base = resolveBase(ROOT, values.base || process.env.TWENTY_LINT_BASE);
  const files = changedFiles(ROOT, values.project, base);
  if (values.list) {
    console.log(
      JSON.stringify({ base, project: values.project, files }, null, 2),
    );
    return;
  }
  console.log(
    `[lint-changed] ${values.project}: ${files.length} changed source files (base ${base.slice(0, 12)})`,
  );
  if (!files.length) return;
  for (const [binary, ...arguments_] of lintCommands(files, values.fix)) {
    const executable = path.join(ROOT, 'node_modules', '.bin', binary);
    if (!existsSync(executable)) {
      throw new Error(
        `Missing ${binary}; run yarn install --immutable in this worktree`,
      );
    }
    const result = spawnSync(executable, arguments_, {
      cwd: path.join(ROOT, 'packages', values.project),
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      return;
    }
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`[lint-changed] ${error.message}`);
    process.exitCode = 1;
  }
}
