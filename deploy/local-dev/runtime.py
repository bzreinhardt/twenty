"""Source processes and Docker services owned by one developer worktree."""
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'migration-test'))
from stack import LABEL, ROOT, Stack, cleanup, docker, wait_for
from checks import assert_plan, assert_status, drain_queues

OWNER = 'tech.spec.local-dev.worktree'
SERVER = ROOT / 'packages/twenty-server'
FRONT = ROOT / 'packages/twenty-front'


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def require_development_dataset(manifest, fixture):
    if manifest['kind'] != 'mirror' and not fixture:
        raise RuntimeError('Local development requires a verified CRM mirror. '
                           'Use --fixture only for synthetic screenshots or clean-initialization checks.')


def available(port):
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', port))
        except OSError:
            raise RuntimeError(f'Local port {port} is in use; stop its owner or choose another port')


def clean_environment():
    # Never inherit a shell's cloud URLs, credentials, NODE_OPTIONS or Nx config.
    environment = {key: os.environ[key] for key in ['PATH', 'LANG', 'TMPDIR', 'SYSTEMROOT']
                   if key in os.environ}
    environment.update(NX_DAEMON='false', NX_ISOLATE_PLUGINS='false',
                       NX_NATIVE_COMMAND_RUNNER='false',
                       NX_LOAD_DOT_ENV_FILES='false', TWENTY_DISABLE_DOTENV='true',
                       NODE_OPTIONS='--max-old-space-size=6144')
    # Nx converts FORCE_COLOR=0 to NO_COLOR, then forces color in child tasks.
    # That conflicting pair hangs tsx/Prettier workers on Node 24; omit both.
    return environment


class LocalStack(Stack):
    def __init__(self, directory, state=None):
        if state is None:
            super().__init__(directory)
        else:
            self.directory = Path(directory)
            self.name = state['name']
            self.timings = {}
            self.environment = {}

    def owned(self):
        if not re.fullmatch(r'twenty-migration-[0-9a-f]{12}', self.name):
            raise RuntimeError('Environment guard: invalid local development resource name')
        for service in ['proxy', 'api', 'worker', 'db', 'redis']:
            result = docker('inspect', f'{self.name}-{service}', check=False)
            if result.returncode:
                continue
            details = json.loads(result.stdout)[0]
            if details['Config'].get('Labels', {}).get(OWNER) != str(ROOT):
                raise RuntimeError('Environment guard: container belongs to another worktree')
            if set(details['NetworkSettings']['Networks']) != {self.name}:
                raise RuntimeError('Environment guard: unexpected database network')
        result = docker('network', 'inspect', self.name, check=False)
        if not result.returncode and json.loads(result.stdout)[0].get('Labels', {}).get(OWNER) != str(ROOT):
            raise RuntimeError('Environment guard: network belongs to another worktree')

    def start(self):
        # Only databases live on this bridge; applications run on the host.
        # Explicit loopback publishing keeps other machines off these services.
        docker('network', 'create', '--label', LABEL, '--label', f'{OWNER}={ROOT}', self.name)
        for service, image, port, command in [
            ('db', self.postgres, 5432, ['postgres', '-c', 'wal_level=logical']),
            ('redis', self.redis, 6379, ['redis-server', '--maxmemory-policy', 'noeviction']),
        ]:
            if docker('image', 'inspect', image, check=False).returncode:
                docker('pull', image)
            arguments = ['run', '-d', '--name', f'{self.name}-{service}', '--label', LABEL,
                         '--label', f'{OWNER}={ROOT}', '--network', self.name,
                         '-p', f'127.0.0.1::{port}']
            if service == 'db':
                arguments += ['-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=default']
            docker(*arguments, image, *command)
        self.ready()

    def ready(self):
        wait_for(lambda: docker('exec', f'{self.name}-db', 'pg_isready', '-h', '127.0.0.1',
                                '-U', 'postgres', check=False).returncode == 0)
        wait_for(lambda: docker('exec', f'{self.name}-redis', 'redis-cli', 'ping',
                                check=False).stdout.strip() == b'PONG')

    def port(self, service, port):
        details = json.loads(docker('inspect', f'{self.name}-{service}').stdout)[0]
        bindings = details['HostConfig']['PortBindings'][f'{port}/tcp']
        if len(bindings) != 1 or bindings[0]['HostIp'] != '127.0.0.1':
            raise RuntimeError('Environment guard: database must be published only on loopback')
        return int(details['NetworkSettings']['Ports'][f'{port}/tcp'][0]['HostPort'])

    def resume(self):
        self.owned()
        for service in ['db', 'redis']:
            docker('start', f'{self.name}-{service}')
        self.ready()

    def close(self):
        self.owned()
        cleanup(self.name)

    def host_environment(self, state):
        environment = clean_environment()
        environment.update(
            PG_DATABASE_URL=f'postgres://postgres:postgres@127.0.0.1:{self.port("db", 5432)}/default',
            REDIS_URL=f'redis://127.0.0.1:{self.port("redis", 6379)}',
            NODE_ENV='development', NODE_HOST='127.0.0.1', NODE_PORT=str(state['api_port']),
            APP_SECRET=state['app_secret'], SERVER_URL=f'http://localhost:{state["front_port"]}',
            FRONTEND_URL=f'http://localhost:{state["front_port"]}',
            STORAGE_TYPE='local', STORAGE_LOCAL_PATH=str(self.directory / 'storage'),
            DISABLE_DB_MIGRATIONS='true', DISABLE_CRON_JOBS_REGISTRATION='true',
            IS_CONFIG_VARIABLES_IN_DB_ENABLED='false', IS_BILLING_ENABLED='false',
            IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS='false',
            SIGN_IN_PREFILLED=str(state['kind'] == 'fixture').lower(),
            EMAIL_DRIVER='LOGGER', EMAILING_DOMAIN_DRIVER='LOG', LOGIC_FUNCTION_TYPE='DISABLED',
            AUTH_GOOGLE_ENABLED='false', AUTH_MICROSOFT_ENABLED='false',
            MESSAGING_PROVIDER_GMAIL_ENABLED='false', MESSAGING_PROVIDER_MICROSOFT_ENABLED='false',
            CALENDAR_PROVIDER_GOOGLE_ENABLED='false', CALENDAR_PROVIDER_MICROSOFT_ENABLED='false',
            IS_IMAP_SMTP_CALDAV_ENABLED='false', MARKETPLACE_CATALOG_SYNC_CRON_ENABLED='false',
            TELEMETRY_ENABLED='false', PG_DATABASE_PRIMARY_TIMEOUT_MS='1800000',
            REACT_APP_PORT=str(state['front_port']), VITE_HOST='127.0.0.1',
            VITE_PROXY_API_TO=f'http://127.0.0.1:{state["api_port"]}',
            REACT_APP_SERVER_BASE_URL=f'http://localhost:{state["front_port"]}',
            REACT_APP_ENVIRONMENT_LABEL=f'local {state["kind"]}',
            ENVIRONMENT_LABEL=f'local {state["kind"]}')
        self.environment = environment
        return environment

    def source(self, *arguments, cwd=SERVER):
        log_path = self.directory / 'current-command.log'
        with log_path.open('wb') as log:
            process = subprocess.Popen(arguments, cwd=cwd, env=self.environment,
                                       stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=900)
            except BaseException:
                stop_process(process)
                raise
        return subprocess.CompletedProcess(arguments, process.returncode, log_path.read_bytes(), b'')

    def command(self, *arguments):
        return self.source('node', 'dist/command/command.js', *arguments)

    def build(self):
        self.phase('source-build', lambda: self.source(str(ROOT / 'node_modules/.bin/nx'),
                   'build', 'twenty-server', cwd=ROOT))


class Processes:
    def __init__(self, directory, environment):
        self.directory = directory
        self.environment = environment
        self.children = []

    def start(self, name, arguments, cwd):
        with (self.directory / f'{name}.log').open('wb') as log:
            process = subprocess.Popen(arguments, cwd=cwd, env=self.environment,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append((name, process))

    def check(self):
        for name, process in self.children:
            if process.poll() is not None:
                raise RuntimeError(f'{name} stopped; inspect its private log')

    def close(self):
        for _, process in self.children:
            stop_process(process)

    def wait_http(self, port, path):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def ready():
            self.check()
            try:
                with opener.open(f'http://127.0.0.1:{port}{path}', timeout=2) as response:
                    return response.status == 200
            except OSError:
                return False
        wait_for(ready, timeout=300)


def stop_process(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def check_node():
    result = subprocess.run(['node', '--version'], env=clean_environment(), capture_output=True, text=True)
    version = re.fullmatch(r'v24\.(\d+)\.\d+\s*', result.stdout)
    if result.returncode or not version or int(version[1]) < 5:
        raise RuntimeError('Select Node 24 before starting this worktree; see .nvmrc')


def watch(stack, state, prepared):
    processes = Processes(stack.directory, stack.environment)
    try:
        # Compile once for both processes; independent Nest watchers race over dist.
        processes.start('compiler', [str(ROOT / 'node_modules/.bin/nest'), 'build', '--watch'], SERVER)
        def compiled():
            processes.check()
            return 'Successfully compiled' in (stack.directory / 'compiler.log').read_text(errors='replace')
        wait_for(compiled, timeout=180)
        for service, entry in [('api', 'dist/main.js'), ('worker', 'dist/queue-worker/queue-worker.js')]:
            paths = ['--watch-path=dist'] if sys.platform == 'darwin' else []
            processes.start(service, ['node', '--watch', '--watch-preserve-output', *paths, entry], SERVER)
        processes.wait_http(state['api_port'], '/healthz')
        stack.phase('background-work', lambda: drain_queues(stack, 300))
        assert_status(stack.phase('upgrade-status', lambda: stack.command('upgrade:status')).stdout.decode())
        assert_plan(stack.phase('upgrade-plan', lambda: stack.command('upgrade', '--dry-run')).stdout.decode())
        prepared()
        processes.start('front', [str(ROOT / 'node_modules/.bin/vite'), '--host', '127.0.0.1',
                                 '--port', str(state['front_port']), '--strictPort'], FRONT)
        processes.wait_http(state['front_port'], '/')
        print(f'[local-dev] Ready: http://localhost:{state["front_port"]} ({state["kind"]})', flush=True)
        print('[local-dev] Source edits reload automatically. Ctrl-C stops watchers and keeps your data.', flush=True)
        print('[local-dev] To replay migrations: Ctrl-C, then bash deploy/local-dev.sh reset', flush=True)
        while True:
            processes.check()
            time.sleep(1)
    finally:
        processes.close()
