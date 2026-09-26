#!/usr/bin/env python3
"""Verify an exact notarized ZIP before updating the website download manifest."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]

def run(*args):
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout + result.stderr

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
args = parser.parse_args()
archive = args.archive.resolve()
if archive.suffix != '.zip':
    parser.error('Use the ZIP containing the exact stapled app.')
with tempfile.TemporaryDirectory(prefix='datolens-publish-') as temporary:
    run('ditto', '-x', '-k', str(archive), temporary)
    app = Path(temporary) / 'Datolens.app'
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != 'com.victoriano.datolens':
        parser.error('Unexpected bundle identifier.')
    if list(app.rglob('*.duckdb_extension')):
        parser.error('Standalone native extension in distribution bundle.')
    if not (app / 'Contents/MacOS/datolens-cli').is_file():
        parser.error('The notarized bundle does not include the Datolens CLI.')
    strict = run('codesign', '--verify', '--deep', '--strict', str(app))
    signature = run('codesign', '-dv', '--verbose=4', str(app))
    if 'Authority=Developer ID Application:' not in signature or 'flags=0x10000(runtime)' not in signature:
        parser.error('Developer ID signing and Hardened Runtime are required.')
    staple = run('xcrun', 'stapler', 'validate', str(app))
    assessment = run('spctl', '--assess', '--type', 'execute', '-vv', str(app))
    if 'source=Notarized Developer ID' not in assessment:
        parser.error('Gatekeeper did not recognize a notarized Developer ID app.')
    binary_sha = hashlib.sha256((app / 'Contents/MacOS/datolens').read_bytes()).hexdigest()

version, build = info['CFBundleShortVersionString'], info['CFBundleVersion']
filename = f'Datolens-{version}-{build}-apple-silicon.zip'
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
destination = ROOT / 'website/public/downloads' / filename
if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != sha:
    parser.error('Refusing to overwrite an immutable release with different bytes.')
destination.parent.mkdir(parents=True, exist_ok=True)
if not destination.exists():
    shutil.copy2(archive, destination)
manifest = json.loads((ROOT / 'website/release.json').read_text())
manifest.update(version=f'{version} beta', build=build, url=f'/downloads/{filename}',
                format='ZIP', bytes=archive.stat().st_size, sha256=sha,
                sizeLabel=f'{archive.stat().st_size / 1024 / 1024:.1f} MB', notarized=True)
(ROOT / 'website/release.json').write_text(json.dumps(manifest, indent=2) + '\n')
(destination.parent / 'SHA256SUMS.txt').write_text(f'{sha}  {filename}\n')
cask = f'''cask "datolens" do
  version "{version},{build}"
  sha256 "{sha}"

  url "https://datolens.victoriano.me/downloads/{filename}"
  name "Datolens"
  desc "Local-first data exploration and enrichment"
  homepage "https://datolens.victoriano.me/"

  depends_on macos: ">= :monterey"

  app "Datolens.app"
  binary "#{{appdir}}/Datolens.app/Contents/MacOS/datolens-cli", target: "datolens"
end
'''
cask_path = ROOT / 'distribution/homebrew/Casks/datolens.rb'
cask_path.parent.mkdir(parents=True, exist_ok=True)
cask_path.write_text(cask)
receipt = dict(verifiedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               bundleIdentifier=info['CFBundleIdentifier'], binarySha256=binary_sha,
               signature=signature, stapler=staple, gatekeeper=assessment, release=manifest)
(ROOT / 'distribution/macos/notarized-provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
