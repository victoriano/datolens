#!/usr/bin/env python3
"""Build the small Launch Services command bundled with Datolens.app."""
import hashlib
import json
import platform
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native/cli/main.m'
IDENTIFIER = 'com.victoriano.datolens.cli'
SIGNING_NAME = 'Datolens Local Development Signing'


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr or f'{args[0]} failed ({result.returncode}).')
    return result


def main():
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning').stdout
    matches = re.findall(r'([A-F0-9]{40})\s+"' + re.escape(SIGNING_NAME) + '"', identities)
    if len(matches) != 1:
        raise SystemExit('Run python3 scripts/setup-local-signing.py to prepare the stable local identity.')
    identity = matches[0]
    arch = {'arm64': 'aarch64', 'x86_64': 'x86_64'}[platform.machine()]
    directory = ROOT / 'native/cli/bin'
    directory.mkdir(parents=True, exist_ok=True)
    binary = directory / f'datolens-cli-{arch}-apple-darwin'
    receipt = binary.with_suffix('.json')
    fingerprint = hashlib.sha256(SOURCE.read_bytes() + identity.encode() + arch.encode() + b'cli-v1').hexdigest()
    if binary.exists() and receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous.get('source') == fingerprint and previous.get('binary') == hashlib.sha256(binary.read_bytes()).hexdigest():
            run('codesign', '--verify', '--strict', str(binary))
            print('Datolens CLI unchanged.')
            return
    temporary = binary.with_suffix('.new')
    run('clang', '-O2', '-fobjc-arc', '-fblocks', '-mmacosx-version-min=12.0', '-Werror', '-Wall', '-Wextra',
        '-Wno-deprecated-declarations', str(SOURCE), '-framework', 'AppKit', '-o', str(temporary))
    run('codesign', '--force', '--sign', identity, '--identifier', IDENTIFIER,
        '--options', 'runtime', '--timestamp=none', str(temporary))
    run('codesign', '--verify', '--strict', str(temporary))
    temporary.replace(binary)
    receipt.write_text(json.dumps({'source': fingerprint, 'binary': hashlib.sha256(binary.read_bytes()).hexdigest()}, indent=2) + '\n')
    print('Prepared signed Datolens CLI.')


if __name__ == '__main__':
    main()
