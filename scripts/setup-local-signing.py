#!/usr/bin/env python3
"""Install a stable, local-only Datolens signing identity in the login Keychain."""

import secrets
import subprocess
import tempfile
from pathlib import Path


NAME = "Datolens Local Development Signing"
KEYCHAIN = Path.home() / "Library/Keychains/login.keychain-db"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


identities = run("security", "find-identity", "-v", "-p", "codesigning", capture_output=True, text=True).stdout
if f'"{NAME}"' in identities:
    print(f"{NAME} is already available; keeping the existing identity.")
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix="datolens-signing-") as directory:
    work = Path(directory)
    key, cert, package = (work / name for name in ("key.pem", "cert.pem", "identity.p12"))
    run(
        "openssl", "req", "-newkey", "rsa:3072", "-sha256", "-nodes", "-x509",
        "-days", "3650", "-keyout", str(key), "-out", str(cert),
        "-subj", f"/CN={NAME}/",
        "-addext", "keyUsage = critical, digitalSignature",
        "-addext", "extendedKeyUsage = codeSigning",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    password = secrets.token_hex(24)
    # macOS Keychain needs the legacy PKCS#12 encryption format from OpenSSL 3.
    run(
        "openssl", "pkcs12", "-export", "-legacy", "-inkey", str(key),
        "-in", str(cert), "-out", str(package), "-passout", f"pass:{password}",
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    run(
        "security", "import", str(package), "-k", str(KEYCHAIN),
        "-P", password, "-T", "/usr/bin/codesign", stdout=subprocess.DEVNULL,
    )
    # Trust only for code signing in the current user's trust settings.
    run("security", "add-trusted-cert", "-r", "trustRoot", "-p", "codeSign",
        "-k", str(KEYCHAIN), str(cert), stdout=subprocess.DEVNULL)

identities = run("security", "find-identity", "-v", "-p", "codesigning", capture_output=True, text=True).stdout
if f'"{NAME}"' not in identities:
    raise SystemExit("The signing identity was imported but is not valid for code signing.")
print(f"Installed {NAME} in the login Keychain for local Datolens builds.")
