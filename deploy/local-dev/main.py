#!/usr/bin/env python3
"""Hot-reloading local CRM, with a private database and an explicit snapshot reset."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import uuid

from runtime import ROOT, LocalStack, available, check_node, free_port, require_development_dataset, watch
from stack import guard

# Both entrypoints are named main.py; load the frozen-baseline implementation explicitly.
spec = importlib.util.spec_from_file_location('migration_main', ROOT / 'deploy/migration-test/main.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

DIRECTORY = ROOT / 'deploy/.local-dev'


def save(state):
    temporary = DIRECTORY / 'state.tmp'
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.replace(DIRECTORY / 'state.json')


def load():
    path = DIRECTORY / 'state.json'
    if not path.exists():
        return None
    state = json.loads(path.read_text())
    if state.get('format') != 1 or state.get('worktree') != str(ROOT):
        raise RuntimeError('Environment guard: local state belongs to another worktree')
    return state


def prepare(args, previous):
    baseline = Path(args.baseline or (previous or {}).get('baseline', '')).resolve()
    if not args.baseline and not previous:
        raise RuntimeError('First start needs --baseline PATH. See deploy/LOCAL-DEV.md to create a saved starting database.')
    manifest = migration.validate_manifest(baseline)
    require_development_dataset(manifest, args.fixture)
    if previous and args.action != 'reset' and manifest['dump_sha256'] != previous['baseline_checksum']:
        raise RuntimeError('Saved snapshot changed; choose a new snapshot identifier and reset explicitly')
    if previous and str(baseline) != previous['baseline'] and args.action != 'reset':
        raise RuntimeError('Use reset --baseline PATH to change datasets; start preserves existing data')
    ports = {key: getattr(args, key) or (previous or {}).get(key) or free_port()
             for key in ['front_port', 'api_port']}
    if ports['front_port'] == ports['api_port']:
        raise RuntimeError('Frontend and API need different ports')
    for port in ports.values():
        available(port)
    if args.action == 'reset' and previous:
        LocalStack(DIRECTORY / previous['name'], previous).close()
        shutil.rmtree(DIRECTORY / previous['name'] / 'storage', ignore_errors=True)
        previous = None
    if previous:
        if not previous['ready']:
            raise RuntimeError('Previous restore or migration failed. Use reset to retry from the saved snapshot.')
        stack = LocalStack(DIRECTORY / previous['name'], previous)
        stack.resume()
        state = dict(previous, **ports)
    else:
        stack = LocalStack(DIRECTORY / 'initializing')
        stack.directory = DIRECTORY / stack.name
        stack.directory.mkdir(mode=0o700)
        stack.postgres, stack.redis = manifest['postgres_image'], manifest['redis_image']
        state = dict(format=1, worktree=str(ROOT), name=stack.name, baseline=str(baseline),
                     baseline_checksum=manifest['dump_sha256'], kind=manifest['kind'],
                     app_secret=uuid.uuid4().hex + uuid.uuid4().hex, ready=False, **ports)
        save(state)
        stack.phase('services', stack.start)
        stack.phase('restore', lambda: migration.restore(stack, baseline / 'baseline.dump'))
        expected = {key: manifest[key] for key in ['postgres_version', 'wal_level', 'extensions', 'database_settings', 'roles']}
        if migration.metadata(stack) != expected:
            raise RuntimeError('Restored database settings differ from the saved snapshot')
        if manifest['kind'] == 'mirror':
            stack.phase('verify-mirror', lambda: stack.sql((ROOT / 'deploy/devdata-verify.sql').read_text()))
    stack.host_environment(state)
    state['ready'] = False
    save(state)
    stack.build()
    for name, arguments in [('instance-upgrade', ['run-instance-commands', '--force', '--include-slow']),
                            ('workspace-upgrade', ['upgrade']), ('cache-flush', ['cache:flush'])]:
        result = stack.phase(name, lambda arguments=arguments: stack.command(*arguments))
        if re.search(r'\bERROR\b', result.stdout.decode(errors='replace')):
            raise RuntimeError(f'{name} logged an error; reset after fixing it')
    return stack, state


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.set_defaults(baseline=None, front_port=None, api_port=None)
    commands = parser.add_subparsers(dest='action', required=True)
    for action in ['start', 'reset']:
        command = commands.add_parser(action)
        command.add_argument('--baseline', help='Frozen verified CRM mirror directory')
        command.add_argument('--fixture', action='store_true',
                             help='Explicit synthetic screenshot or clean-initialization session')
        command.add_argument('--port', dest='front_port', type=int, help='Frontend port (first start chooses a free port)')
        command.add_argument('--api-port', type=int, help='API port (first start chooses a free port)')
    commands.add_parser('status')
    commands.add_parser('down')
    command = commands.add_parser('command', help='Run a server CLI command against this worktree\'s local database')
    command.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    for port in [args.front_port, args.api_port]:
        if port is not None and not 1 <= port <= 65535:
            parser.error('Ports must be between 1 and 65535')
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (DIRECTORY / 'lock').open('w') as lock:
        running = False
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.action != 'status':
                raise RuntimeError('This worktree is running. Stop its watchers with Ctrl-C before resetting or starting again.')
            running = True
        guard()
        previous = load()
        if args.action == 'status':
            if previous:
                print(f'[local-dev] Dataset: {previous["kind"]}; baseline checksum: {previous["baseline_checksum"]}')
                print(f'[local-dev] URL: http://localhost:{previous["front_port"]}; prepared: {previous["ready"]}')
                print(f'[local-dev] Supervisor running: {running}')
            else:
                print('[local-dev] No local environment. Start with --baseline PATH.')
            return
        if args.action == 'down':
            if previous:
                LocalStack(DIRECTORY / previous['name'], previous).close()
                shutil.rmtree(DIRECTORY / previous['name'] / 'storage', ignore_errors=True)
                (DIRECTORY / 'state.json').unlink()
            print('[local-dev] Removed this worktree\'s database, Redis and local uploads. Saved snapshot retained.')
            return
        if not (ROOT / 'node_modules/.bin/nx').exists():
            raise RuntimeError('Install this worktree\'s dependencies with yarn install --immutable first')
        check_node()
        print(f'[local-dev] Private diagnostics: {DIRECTORY}', flush=True)
        if args.action == 'command':
            arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
            if not previous or not previous['ready'] or not arguments:
                raise RuntimeError('A prepared local environment and a server command are required')
            stack = LocalStack(DIRECTORY / previous['name'], previous)
            stack.resume()
            stack.host_environment(previous)
            stack.build()
            stack.phase('developer-command', lambda: stack.command(*arguments))
            print(f'[local-dev] Command output: {stack.directory / "developer-command.log"}')
            return
        stack, state = prepare(args, previous)
        watch(stack, state, lambda: save(dict(state, ready=True)))


if __name__ == '__main__':
    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except KeyboardInterrupt:
        print('[local-dev] Stopped; local data retained. Use start to resume, or reset after an interrupted migration.')
    except Exception as error:
        if hasattr(error, 'output'):
            (DIRECTORY / 'failure.log').write_bytes(error.output)
        print(f'[local-dev] FAIL: {error}', file=sys.stderr)
        sys.exit(1)
