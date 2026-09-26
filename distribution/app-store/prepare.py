#!/usr/bin/env python3
"""Read-only preflight by default; generate a profile-specific Tauri overlay on request."""
import argparse, datetime, hashlib, json, os, pathlib, plistlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUNDLE_ID = 'com.victoriano.datolens'

def run(*args):
    return subprocess.run(args, capture_output=True, text=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--generate', action='store_true', help='Write ignored generated configuration after all signing checks pass')
    p.add_argument('--team-id', default=os.getenv('DATOLENS_APPLE_TEAM_ID'))
    p.add_argument('--profile', default=os.getenv('DATOLENS_PROVISION_PROFILE'))
    p.add_argument('--signing-identity', default=os.getenv('DATOLENS_APP_SIGN_IDENTITY'))
    p.add_argument('--installer-identity', default=os.getenv('DATOLENS_INSTALLER_IDENTITY'))
    p.add_argument('--build-number', default='1')
    a = p.parse_args()
    issues = []
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning').stdout
    certs = run('security', 'find-certificate', '-a').stdout
    if not re.fullmatch(r'[A-Z0-9]{10}', a.team_id or ''):
        issues.append('A valid 10-character Apple Developer Team ID is required.')
    if not a.signing_identity or a.signing_identity not in identities:
        issues.append('The selected Apple distribution code-signing identity is not installed.')
    elif not any(n in a.signing_identity for n in ('Apple Distribution:', '3rd Party Mac Developer Application:')):
        issues.append('App Store needs an Apple Distribution or Mac App Distribution identity; local/Developer ID signing is not sufficient.')
    if not a.installer_identity or a.installer_identity not in certs:
        issues.append('The selected Mac Installer Distribution certificate is not installed.')
    elif '3rd Party Mac Developer Installer:' not in a.installer_identity:
        issues.append('Use Mac Installer Distribution, not Developer ID Installer.')
    if not re.fullmatch(r'[1-9][0-9]*', a.build_number):
        issues.append('Build number must be a positive integer.')
    profile = None
    if not a.profile or not pathlib.Path(a.profile).is_file():
        issues.append('A macOS App Store distribution provisioning profile is required.')
    else:
        decoded = run('security', 'cms', '-D', '-i', a.profile)
        try:
            profile = plistlib.loads(decoded.stdout.encode())
        except (plistlib.InvalidFileException, ValueError):
            issues.append('The provisioning profile could not be decoded.')
        if profile:
            ent = profile.get('Entitlements', {})
            appid = ent.get('com.apple.application-identifier', ent.get('application-identifier', ''))
            if appid.split('.', 1)[-1] != BUNDLE_ID:
                issues.append('Provisioning profile Bundle ID does not match Datolens.')
            if a.team_id not in profile.get('TeamIdentifier', []):
                issues.append('Provisioning profile Team ID does not match.')
            expiry = profile.get('ExpirationDate')
            if not expiry or expiry.replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
                issues.append('Provisioning profile is expired or has no expiration date.')
            if ent.get('get-task-allow') or ent.get('com.apple.security.get-task-allow') or profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'):
                issues.append('Use an App Store distribution profile, not a development/Developer ID profile.')
            if not any(x in ('OSX', 'macOS') for x in profile.get('Platform', [])):
                issues.append('Provisioning profile is not for macOS.')
            # A profile must contain the certificate chosen for code signing.
            fingerprints = {hashlib.sha1(c).hexdigest().upper() for c in profile.get('DeveloperCertificates', [])}
            matched = re.search(r'([A-F0-9]{40})\s+"' + re.escape(a.signing_identity or '') + '"', identities)
            if matched and matched.group(1) not in fingerprints:
                issues.append('Signing certificate is not included in this provisioning profile.')
    upload_tool = run('xcrun', '--find', 'altool')
    report = {'bundleId': BUNDLE_ID, 'signingReady': not issues,
              'uploadToolAvailable': upload_tool.returncode == 0,
              'issues': issues,
              'remainingValidation': ['App Sandbox source access after restart and sidecar writes',
                                      'DuckDB/httpfs and Keychain in sandbox',
                                      'App Privacy, trader status, pricing and App Review']}
    print(json.dumps(report, indent=2))
    if issues:
        return 1
    if a.generate:
        runtime = ROOT / 'artifacts/distribution/duckdb-build/src/libduckdb.dylib'
        notices = ROOT / 'distribution/ThirdPartyNotices.txt'
        if not runtime.is_file() or not notices.is_file():
            sys.exit('Build the distribution DuckDB with built-in httpfs and collect third-party notices first.')
        generated = ROOT / 'distribution/generated'
        generated.mkdir(parents=True, exist_ok=True)
        profile_ent = profile['Entitlements']
        app_id = profile_ent.get('com.apple.application-identifier', profile_ent.get('application-identifier'))
        entitlements = {
            'com.apple.security.app-sandbox': True,
            'com.apple.security.network.client': True,
            'com.apple.security.files.user-selected.read-write': True,
            'com.apple.security.files.bookmarks.app-scope': True,
            'com.apple.application-identifier': app_id,
            'com.apple.developer.team-identifier': a.team_id,
        }
        if 'keychain-access-groups' in profile_ent:
            entitlements['keychain-access-groups'] = [app_id]
        ent_path = generated / 'Entitlements.plist'
        ent_path.write_bytes(plistlib.dumps(entitlements))
        info_path = generated / 'Info.plist'
        # Standard HTTPS only; confirm this against the final build and export questionnaire.
        info_path.write_bytes(plistlib.dumps({'ITSAppUsesNonExemptEncryption': False}))
        config = {'build': {'beforeBuildCommand': 'python3 scripts/build-cli.py && python3 scripts/build-credential-helper.py && bunx vite build --outDir artifacts/distribution/store-frontend',
                            'frontendDist': '../artifacts/distribution/store-frontend'},
                  'bundle': {'resources': [], 'macOS': {'entitlements': str(ent_path), 'infoPlist': str(info_path),
                                       'signingIdentity': a.signing_identity, 'bundleVersion': a.build_number,
                                       'hardenedRuntime': True, 'minimumSystemVersion': '12.0',
                                       'frameworks': [str(runtime)],
                                       'files': {'embedded.provisionprofile': str(pathlib.Path(a.profile).resolve()),
                                                 'Resources/ThirdPartyNotices.txt': str(notices)}}}}
        (generated / 'tauri.appstore.conf.json').write_text(json.dumps(config, indent=2) + '\n')
        print('Generated profile-specific entitlements and Tauri overlay; sandbox QA is still required.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
