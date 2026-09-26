#!/usr/bin/env python3
import platform
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCH = {'arm64': 'aarch64', 'x86_64': 'x86_64'}[platform.machine()]
CLI = ROOT / f'native/cli/bin/datolens-cli-{ARCH}-apple-darwin'


class DatolensCliTests(unittest.TestCase):
    def run_cli(self, *arguments):
        return subprocess.run([str(CLI), *arguments], capture_output=True, text=True)

    def test_help_and_version_do_not_launch_the_app(self):
        self.assertIn('Usage: datolens', self.run_cli('--help').stdout)
        self.assertEqual(self.run_cli('--version').stdout.strip(), 'datolens 0.1.0')

    def test_missing_and_unsupported_files_are_rejected_before_launch_services(self):
        self.assertEqual(self.run_cli('/definitely/missing.csv').returncode, 66)
        with tempfile.NamedTemporaryFile(suffix='.txt') as file:
            result = self.run_cli(file.name)
        self.assertEqual(result.returncode, 64)
        self.assertIn('unsupported file type', result.stderr)


if __name__ == '__main__':
    unittest.main()
