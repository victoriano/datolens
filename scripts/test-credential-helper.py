#!/usr/bin/env python3
"""Native security regression: only synthetic keys under UUID test services.

Tests the actual helper source against two differently built signed parents and
untrusted parents. Production helper/accounts are never called or modified.
"""
import hashlib
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'native/credential-helper'


def run(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr or result.stdout}')
    return result


def main():
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning').stdout
    identity = re.search(r'([A-F0-9]{40})\s+"Datolens Local Development Signing"', identities)[1]
    with tempfile.TemporaryDirectory(prefix='datolens-credential-qa-') as temporary:
        work = Path(temporary)
        service = 'com.victoriano.datolens.credential-test.' + uuid.uuid4().hex
        helper = work / 'helper'
        run('clang', '-O2', '-Werror', '-Wall', '-Wextra', '-Wno-deprecated-declarations',
            '-mmacosx-version-min=12.0', '-DDATOLENS_HELPER_TEST',
            f'-DDATOLENS_CREDENTIAL_SERVICE="{service}"',
            f'-DDATOLENS_LEGACY_SERVICE="{service}.legacy"', str(NATIVE/'main.c'),
            '-framework', 'Security', '-framework', 'CoreFoundation', '-o', str(helper))
        run('codesign', '--force', '--sign', identity, '--options', 'runtime', '--timestamp=none',
            '--identifier', 'com.victoriano.datolens.credentials.test', str(helper))
        parents = []
        for index, identifier in enumerate(['com.victoriano.datolens', 'com.victoriano.datolens', 'com.example.untrusted', 'com.victoriano.datolens', 'com.victoriano.datolens', 'com.victoriano.datolens']):
            parent = work / f'parent-{index}'
            run('clang', '-O2', f'-DBUILD_MARKER={index}', str(NATIVE/'probe.c'), '-o', str(parent))
            signing = ['codesign', '--force', '--sign', '-' if index == 4 else identity, '--timestamp=none', '--identifier', identifier]
            if index != 3: signing += ['--options', 'runtime']
            if index == 5:
                entitlements = work / 'unsafe.plist'
                entitlements.write_text('<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>')
                signing += ['--entitlements', str(entitlements)]
            run(*signing, str(parent))
            parents.append(parent)
        first_signature = run('codesign', '--display', '--verbose=4', str(parents[0])).stderr
        second_signature = run('codesign', '--display', '--verbose=4', str(parents[1])).stderr
        assert re.search(r'CDHash=(\w+)', first_signature)[1] != re.search(r'CDHash=(\w+)', second_signature)[1]
        helper_hash = hashlib.sha256(helper.read_bytes()).hexdigest()

        def probe(index, op, provider=0, expected='status=0', check=True):
            result = run(str(parents[index]), str(helper), str(op), str(provider), check=check)
            assert expected in result.stdout, result.stdout
            return result

        try:
            probe(0, 3, expected='status=-25300')
            probe(0, 2)
            probe(0, 1, expected='matches=1')
            probe(1, 1, expected='matches=1')
            for _ in range(5): probe(1, 1, expected='matches=1')
            print('PASS: saved key survives separate processes and changed parent cdhash without interaction')
            # Reproduce the real regression: Tauri used to replace the app on
            # disk while its old process remained alive. Both files are validly
            # signed, but the running old image no longer matches its path.
            waiting = subprocess.Popen([str(parents[0]), str(helper), '1', '0', '--wait-for-update'],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                assert waiting.stdout.readline().strip() == 'ready'
                replacement = work / 'replacement'
                shutil.copy2(parents[1], replacement)
                replacement.replace(parents[0])
                output, error = waiting.communicate('\n', timeout=10)
                assert waiting.returncode == 77 and 'denied=77' in output, (waiting.returncode, output, error)
            finally:
                if waiting.poll() is None:
                    waiting.kill(); waiting.wait()
            probe(0, 1, expected='matches=1')
            print('PASS: replacing a live signed parent reproduces denial; a fresh process recovers without a Keychain prompt')
            probe(2, 1, expected='denied=77', check=False)
            probe(3, 1, expected='denied=77', check=False)
            probe(4, 1, expected='denied=77', check=False)
            probe(5, 1, expected='denied=77', check=False)
            direct = subprocess.run([str(helper)], input=b'', capture_output=True, timeout=10)
            assert direct.returncode == 77 and not direct.stdout
            print('PASS: wrong app identifier, unhardened/ad-hoc/debuggable parents and direct script access rejected')
            probe(0, 4)
            probe(0, 3, expected='status=-25300')
            probe(0, 6)
            probe(0, 3)
            probe(0, 1, expected='matches=1')
            probe(1, 1, expected='matches=1')
            print('PASS: legacy migration persists a new protected item and survives parent rebuild')
            probe(1, 2, provider=1)
            probe(1, 1, provider=1, expected='matches=1')
            probe(1, 4, provider=1)
            probe(1, 1, provider=1, expected='status=-25300')
            probe(1, 1, expected='matches=1')
            print('PASS: both providers, independent deletion and no resurrection')
            assert hashlib.sha256(helper.read_bytes()).hexdigest() == helper_hash
            print('PASS: helper binary unchanged throughout; no production credentials accessed')
        finally:
            for provider in (0, 1): probe(0, 4, provider)
            print('Synthetic Keychain fixtures removed.')


if __name__ == '__main__':
    main()
