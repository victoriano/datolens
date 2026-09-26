#!/usr/bin/env python3
"""Prepare a Datolens archive for Xcode's existing cloud signing account.

Does not upload, create credentials or copy private keys. The source app must
already contain distribution-safe native libraries and pass native QA.
"""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]

def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('channel', choices=['app-store', 'developer-id'])
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--build', type=int, required=True)
    parser.add_argument('--sandbox-qa', action='store_true', help='Developer ID signing for the isolated Store QA app only; never publish this archive.')
    parser.add_argument('--team', default=os.getenv('DATOLENS_APPLE_TEAM_ID'), required=not os.getenv('DATOLENS_APPLE_TEAM_ID'))
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/distribution/xcode-archives')
    a = parser.parse_args()
    if a.build < 1 or not re.fullmatch(r'[A-Z0-9]{10}', a.team):
        parser.error('Use a positive build number and a 10-character Team ID.')
    source = a.app.resolve()
    info = plistlib.loads((source/'Contents/Info.plist').read_bytes())
    expected_id = 'com.victoriano.datolens.storeqa' if a.sandbox_qa else 'com.victoriano.datolens'
    if info.get('CFBundleIdentifier') != expected_id or (a.sandbox_qa and a.channel != 'developer-id'):
        parser.error('Expected the matching Datolens bundle identifier; isolated QA is Developer ID only.')
    executable = info.get('CFBundleExecutable')
    if not executable or not (source/'Contents/MacOS'/executable).is_file():
        parser.error('Missing native executable.')
    # Official DuckDB extension files carry an appended signature and currently
    # fail codesign strict validation. Distribution must use the built-in httpfs
    # library path; never remove this guard by disabling extension validation.
    if list(source.rglob('*.duckdb_extension')):
        parser.error('A standalone DuckDB extension remains; use the tested built-in-httpfs distribution variant.')
    binaries = [source/'Contents/MacOS'/executable, *sorted((source/'Contents/Frameworks').glob('*.dylib'))]
    for binary in binaries:
        if re.search(r'^\s+/(?:opt/homebrew|usr/local|Users)/', run('otool','-L',str(binary)), re.M):
            parser.error(f'External non-system library dependency: {binary.name}')
    version = info['CFBundleShortVersionString']
    output = a.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    prefix = 'Datolens-StoreQA' if a.sandbox_qa else 'Datolens'
    archive = output/f'{prefix}-{a.channel}-{version}-{a.build}.xcarchive'
    if archive.exists():
        parser.error('Archive already exists. Preserve it and choose a new build/output.')
    with tempfile.TemporaryDirectory(prefix='datolens-archive-', dir=output) as temporary:
        stage = Path(temporary)/archive.name
        app = stage/'Products/Applications/Datolens.app'
        app.parent.mkdir(parents=True)
        run('ditto',str(source),str(app))
        notices = ROOT/'distribution/ThirdPartyNotices.txt'
        if not notices.is_file():
            raise SystemExit('Generate third-party notices before packaging.')
        (app/'Contents/Resources').mkdir(exist_ok=True)
        (app/'Contents/Resources/ThirdPartyNotices.txt').write_bytes(notices.read_bytes())
        info.update(CFBundleVersion=str(a.build), CFBundleSupportedPlatforms=['MacOSX'])
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        run('chmod','-R','a+rX',str(app))
        sign = ['codesign','--force','--sign','-','--options','runtime']
        for library in sorted((app/'Contents/Frameworks').glob('*.dylib')):
            run(*sign,str(library))
        cli = app/'Contents/MacOS/datolens-cli'
        if not cli.is_file():
            raise SystemExit('The bundle is missing the Datolens CLI.')
        cli_sign = sign.copy()
        if a.channel == 'app-store' or a.sandbox_qa:
            cli_sign += ['--entitlements',str(ROOT/'native/cli/Sandbox.entitlements')]
        run(*cli_sign,str(cli))
        app_sign = sign.copy()
        if a.channel == 'app-store' or a.sandbox_qa:
            app_sign += ['--entitlements',str(ROOT/'distribution/macos/SandboxQA.entitlements')]
        run(*app_sign,str(app))
        run('codesign','--verify','--deep','--strict',str(app))
        archive_info = {
            'ArchiveVersion':2,
            'CreationDate':datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
            'Name':'Datolens','SchemeName':'Datolens',
            'ApplicationProperties':{
                'ApplicationPath':'Applications/Datolens.app','Architectures':['arm64'],
                'CFBundleIdentifier':expected_id,
                'CFBundleShortVersionString':version,'CFBundleVersion':str(a.build),
                'SigningIdentity':'-','Team':a.team,
            },
        }
        (stage/'Info.plist').write_bytes(plistlib.dumps(archive_info))
        stage.rename(archive)
    options = {'method':'app-store-connect' if a.channel=='app-store' else 'developer-id',
               'signingStyle':'automatic','teamID':a.team,
               'manageAppVersionAndBuildNumber':False,'uploadSymbols':False}
    for destination in ('export','upload'):
        options['destination'] = destination
        (output/f'{a.channel}-{destination}.plist').write_bytes(plistlib.dumps(options))
    print(archive)
    print('Ad-hoc archive only. Xcode export with its existing account must provide the Apple distribution signature.')

if __name__ == '__main__':
    main()
