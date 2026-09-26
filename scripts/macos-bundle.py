#!/usr/bin/env python3
"""Build beside the installed app; never rewrite a running signed bundle."""
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'src-tauri/target'
STAGING = TARGET / 'macos-staging'
# A stable user-facing location survives Cargo cleanup and keeps Dock links valid.
INSTALLED = Path('/Applications/Datolens.app')
PENDING = TARGET / 'macos-pending.json'
SIGNING_NAME = 'Datolens Local Development Signing'


def run(*args, env=None, capture=False):
    return subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                          capture_output=capture)


def running_apps():
    # comm is the executable path, unlike argv which can be changed by a process.
    output = run('ps', '-axo', 'pid=,comm=', capture=True).stdout
    result = []
    for line in output.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        executable = Path(parts[1])
        if executable.name.lower() == 'datolens' and executable.parent.name == 'MacOS':
            result.append((int(parts[0]), executable.parent.parent.parent.resolve()))
    return result


def running_at(bundle):
    return [pid for pid, path in running_apps() if path == bundle.resolve()]


def guard_bundle_destination():
    # Also protects direct `bun tauri build/bundle` calls, before Tauri touches
    # the bundle. The wrapper packages into its own empty CARGO_TARGET_DIR.
    directory = Path(os.environ.get('CARGO_TARGET_DIR', TARGET)).resolve()
    for pid, bundle in running_apps():
        if bundle.is_relative_to(directory):
            raise RuntimeError(f'Datolens is running in this target (PID {pid}). '
                               'Use scripts/build-macos.sh to stage the update safely; '
                               'do not rebuild or re-sign the open app in place.')
    if directory == TARGET.resolve():
        raise RuntimeError('Use scripts/build-macos.sh to package the main app in staging '
                           'and preserve the authorized credential helper.')


@contextmanager
def build_lock():
    TARGET.mkdir(parents=True, exist_ok=True)
    with (TARGET / '.macos-build.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another macOS build or installation is in progress.') from None
        yield


def identity():
    listing = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True).stdout
    matches = re.findall(r'([A-F0-9]{40})\s+"' + re.escape(SIGNING_NAME) + '"', listing)
    if len(matches) != 1:
        raise RuntimeError('Run scripts/setup-local-signing.py once to prepare the local identity.')
    return matches[0]


def helper_path():
    host = re.search(r'^host: (.+)$', run('rustc', '-vV', capture=True).stdout, re.M)[1]
    return ROOT / f'native/credential-helper/bin/datolens-credentials-{host}'


def cli_path():
    host = re.search(r'^host: (.+)$', run('rustc', '-vV', capture=True).stdout, re.M)[1]
    return ROOT / f'native/cli/bin/datolens-cli-{host}'


def verify_bundle(bundle, signing_identity):
    run('codesign', '--verify', '--deep', '--strict', str(bundle))
    rule = f'identifier "com.victoriano.datolens" and certificate leaf = H"{signing_identity}"'
    run('codesign', '--verify', '-R', '=' + rule, str(bundle))
    info = run('codesign', '--display', '--verbose=4', str(bundle), capture=True).stderr
    if 'flags=0x10000(runtime)' not in info:
        raise RuntimeError('The prepared app is missing Hardened Runtime.')
    if (bundle / 'Contents/MacOS/datolens-credentials').read_bytes() != helper_path().read_bytes():
        raise RuntimeError('The packaged credential helper has changed; refusing installation.')
    if (bundle / 'Contents/MacOS/datolens-cli').read_bytes() != cli_path().read_bytes():
        raise RuntimeError('The packaged CLI has changed; refusing installation.')


def install_bundle(bundle, installed=INSTALLED):
    """Keep the old bundle intact, including its inode, until all users exit."""
    if running_at(installed):
        return False
    if running_at(bundle):
        raise RuntimeError('Close the staged app before installing it.')
    installed.parent.mkdir(parents=True, exist_ok=True)
    # Keep a rollback copy by moving the directory, never copying over files.
    previous = bundle.parent / 'PreviousDatolens.app'
    if previous.exists():
        raise RuntimeError('The previous bundle already exists; refusing to overwrite it.')
    had_previous = installed.exists()
    if had_previous:
        installed.rename(previous)
    try:
        bundle.rename(installed)
    except BaseException:
        if had_previous:
            previous.rename(installed)
        raise
    print(f'Installed verified app: {installed}', flush=True)
    if had_previous:
        print(f'Previous app retained: {previous}', flush=True)
    return True


def finish_pending(explicit=False):
    if not PENDING.exists():
        raise RuntimeError('There is no staged macOS update. Run scripts/build-macos.sh first.')
    receipt = json.loads(PENDING.read_text())
    bundle = Path(receipt['bundle']).resolve()
    if not bundle.is_relative_to(STAGING.resolve()) or bundle.name != 'Datolens.app':
        raise RuntimeError('Invalid staged bundle path.')
    verify_bundle(bundle, identity())
    if not install_bundle(bundle):
        message = ('Update staged. The running Datolens app was left intact. '
                   'After quitting Datolens, run: scripts/build-macos.sh --install-pending')
        if explicit:
            raise RuntimeError(message)
        print(message, flush=True)
        print(f'Staged bundle: {bundle}', flush=True)
        return False
    PENDING.unlink()
    return True


def build():
    signing_identity = identity()
    if not (ROOT / 'vendor/duckdb/libduckdb.dylib').is_file():
        raise RuntimeError('Missing DuckDB library; run scripts/prepare-duckdb.sh first.')
    httpfs = ROOT / 'vendor/httpfs/osx_arm64/httpfs.duckdb_extension'
    if not httpfs.is_file() or hashlib.sha256(httpfs.read_bytes()).hexdigest() != '10514b4ef19f80bf4ec4bf90c124f5d34625f2606263b40ae8ec7979905bb779':
        raise RuntimeError('Pinned httpfs extension is missing or its checksum does not match.')
    env = dict(os.environ, CARGO_TARGET_DIR=str(TARGET))
    # Reuse Cargo artifacts without touching Contents/MacOS of the open app.
    run('bun', 'tauri', 'build', '--debug', '--no-bundle', env=env)
    STAGING.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='build-', dir=STAGING))
    (stage / 'debug').mkdir()
    shutil.copy2(TARGET / 'debug/datolens', stage / 'debug/datolens')
    run('bun', 'tauri', 'bundle', '--debug', '--bundles', 'app',
        env=dict(env, CARGO_TARGET_DIR=str(stage)))
    bundle = stage / 'debug/bundle/macos/Datolens.app'
    # Tauri re-signs sidecars. Restore the original authorized helper byte for
    # byte, using a new inode rather than rewriting a signed executable.
    for bundled, original in ((bundle / 'Contents/MacOS/datolens-credentials', helper_path()),
                              (bundle / 'Contents/MacOS/datolens-cli', cli_path())):
        temporary = bundled.with_suffix('.new')
        shutil.copy2(original, temporary)
        temporary.replace(bundled)
    run('codesign', '--force', '--sign', signing_identity, '--timestamp=none',
        str(bundle / 'Contents/Frameworks/libduckdb.dylib'))
    run('codesign', '--force', '--sign', signing_identity, '--timestamp=none', '--options', 'runtime',
        '--entitlements', str(ROOT / 'native/credential-helper/Datolens.entitlements'), str(bundle))
    verify_bundle(bundle, signing_identity)
    pending = PENDING.with_suffix('.new')
    pending.write_text(json.dumps({'bundle': str(bundle)}, indent=2) + '\n')
    pending.replace(PENDING)
    finish_pending()


def main():
    os.environ['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + os.environ['PATH']
    mode = sys.argv[1] if len(sys.argv) == 2 else 'build' if len(sys.argv) == 1 else ''
    if mode == 'guard':
        guard_bundle_destination()
    elif mode in ('build', '--install-pending'):
        with build_lock():
            build() if mode == 'build' else finish_pending(explicit=True)
    else:
        raise RuntimeError('Usage: scripts/build-macos.sh [--install-pending]')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
