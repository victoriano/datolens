#!/usr/bin/env python3
"""Collect installed dependency notices without publishing local source paths."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
work = root/'artifacts/distribution'
out = root/'distribution/ThirdPartyNotices.txt'
metadata = json.loads(subprocess.check_output([
    str(Path.home()/'.cargo/bin/cargo'), 'metadata', '--manifest-path',
    str(root/'src-tauri/Cargo.toml'), '--format-version','1','--locked',
    '--filter-platform','aarch64-apple-darwin',
]))
sections = []
missing = []
upstream = json.loads((root/'distribution/licenses/index.json').read_text()) if (root/'distribution/licenses/index.json').exists() else {}
def add(name, directory, expression='', explicit=None):
    files = set()
    for p in directory.iterdir():
        if p.is_file() and p.name.upper().startswith(('LICENSE','LICENCE','COPYING','COPYRIGHT','NOTICE')):
            files.add(p)
    if explicit:
        f = directory/explicit
        if f.is_file(): files.add(f)
    extras = upstream.get(name, [])
    if not files and not extras:
        missing.append({'package':name,'declaredLicense':expression})
    texts = []
    for f in sorted(files):
        try: texts.append(f.name+'\n'+f.read_text())
        except UnicodeDecodeError: continue
    for entry in extras:
        texts.append('Upstream notice: '+entry['url']+'\n'+(root/'distribution/licenses'/entry['file']).read_text())
    sections.append(name+('\nDeclared license: '+expression if expression else '')+'\n\n'+'\n\n'.join(texts))

for package in sorted(metadata['packages'], key=lambda p:(p['name'],p['version'])):
    if package['source']:
        add(package['name']+' '+package['version'],Path(package['manifest_path']).parent,
            package.get('license') or '',package.get('license_file'))

seen = set()
def npm(name, parent):
    folder = None
    for ancestor in [parent,*parent.parents]:
        candidate = ancestor/'node_modules'/name
        if (candidate/'package.json').exists():
            folder = candidate.resolve();break
    if folder is None: raise RuntimeError('Missing installed npm dependency '+name)
    if folder in seen:return
    seen.add(folder)
    package = json.loads((folder/'package.json').read_text())
    add(package['name']+' '+package.get('version',''),folder,str(package.get('license','')))
    for dependency in package.get('dependencies',{}): npm(dependency,folder)
for name in json.loads((root/'package.json').read_text())['dependencies']:
    npm(name,root)

duck = work/'duckdb-src'
add('DuckDB 1.5.5',duck,'MIT')
add('DuckDB httpfs',work/'duckdb-build/_deps/httpfs_extension_fc-src','MIT')
add('OpenSSL 3.6.4',work/'openssl-src','Apache-2.0')
for parent in sorted({p.parent for p in (duck/'third_party').rglob('*') if p.is_file() and p.name.upper().startswith(('LICENSE','LICENCE','COPYING','COPYRIGHT','NOTICE'))}):
    add('DuckDB third-party component: '+str(parent.relative_to(duck/'third_party')),parent)
for parent in [duck/'extension/icu/third_party/icu']:
    add('ICU',parent)
out.write_text('Datolens — Third-party notices\n\nIncludes runtime and build dependencies from the installed dependency graph.\nThe following notices retain their respective authors and terms.\n\n'+'\n\n'+('\n\n'+'='*72+'\n\n').join(sections))
(work/'notices-review.json').write_text(json.dumps({'sections':len(sections),'missingLicenseFiles':missing},indent=2)+'\n')
print(json.dumps({'sections':len(sections),'bytes':out.stat().st_size,'missingLicenseFiles':len(missing)}))
