#!/usr/bin/env python3
"""Build/sign the credential helper only when its own source or identity changes.

Ordinary app rebuilds must preserve its exact cdhash, including after clean builds.
No credentials, signing private keys or Keychain data are copied into the project.
"""
import hashlib
import json
import platform
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native/credential-helper/main.c'
IDENTIFIER = 'com.victoriano.datolens.credentials'
NAME = 'Datolens Local Development Signing'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr or f'{args[0]} failed ({result.returncode}).')
    return result


def main():
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning').stdout
    matches = re.findall(r'([A-F0-9]{40})\s+"' + re.escape(NAME) + '"', identities)
    if len(matches) != 1:
        raise SystemExit('Run python3 scripts/setup-local-signing.py to prepare the stable local identity.')
    identity = matches[0]
    arch = {'arm64': 'aarch64', 'x86_64': 'x86_64'}[platform.machine()]
    directory = ROOT / 'native/credential-helper/bin'
    directory.mkdir(parents=True, exist_ok=True)
    binary = directory / f'datolens-credentials-{arch}-apple-darwin'
    receipt = binary.with_suffix('.json')
    fingerprint = hashlib.sha256(SOURCE.read_bytes() + identity.encode() + arch.encode() + b'helper-v1').hexdigest()
    if binary.exists() and receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous.get('source') == fingerprint and previous.get('binary') == hashlib.sha256(binary.read_bytes()).hexdigest():
            run('codesign', '--verify', '--strict', str(binary))
            print('Credential helper unchanged; preserving its Keychain identity.')
            return
    temporary = binary.with_suffix('.new')
    run('clang', '-O2', '-mmacosx-version-min=12.0', '-Werror', '-Wall', '-Wextra',
        '-Wno-deprecated-declarations', str(SOURCE), '-framework', 'Security',
        '-framework', 'CoreFoundation', '-o', str(temporary))
    run('codesign', '--force', '--sign', identity, '--identifier', IDENTIFIER,
        '--options', 'runtime', '--timestamp=none', str(temporary))
    run('codesign', '--verify', '--strict', str(temporary))
    temporary.replace(binary)
    receipt.write_text(json.dumps({'source': fingerprint, 'binary': hashlib.sha256(binary.read_bytes()).hexdigest()}, indent=2) + '\n')
    print('Prepared signed Datolens credential helper.')


if __name__ == '__main__':
    main()
