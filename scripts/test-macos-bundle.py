#!/usr/bin/env python3
"""Regression for installing beside live processes. No real app or keys touched."""
import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('macos_bundle', Path(__file__).with_name('macos-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class SafeInstallTests(unittest.TestCase):
    def test_running_app_is_not_touched_and_update_installs_only_after_exit(self):
        with tempfile.TemporaryDirectory(prefix='datolens-bundle-test-') as temporary:
            root = Path(temporary)
            installed = root / 'installed/Datolens.app'
            executable = installed / 'Contents/MacOS/datolens'
            executable.parent.mkdir(parents=True)
            shutil.copy('/bin/sleep', executable)
            staged = root / 'staged/Datolens.app'
            staged.mkdir(parents=True)
            (staged / 'version').write_text('new')
            inode = executable.stat().st_ino
            process = subprocess.Popen([str(executable), '30'])
            try:
                self.assertIn(process.pid, bundle.running_at(installed))
                self.assertFalse(bundle.install_bundle(staged, installed))
                self.assertEqual(executable.stat().st_ino, inode)
                self.assertTrue(staged.exists())
                with patch.dict(os.environ, {'CARGO_TARGET_DIR': str(root)}):
                    with self.assertRaisesRegex(RuntimeError, 'Datolens is running'):
                        bundle.guard_bundle_destination()
                with patch.dict(os.environ, {'CARGO_TARGET_DIR': str(root / 'separate-target')}):
                    bundle.guard_bundle_destination()
            finally:
                process.terminate()
                process.wait(timeout=5)
            self.assertTrue(bundle.install_bundle(staged, installed))
            self.assertEqual((installed / 'version').read_text(), 'new')
            self.assertEqual((root / 'staged/PreviousDatolens.app/Contents/MacOS/datolens').stat().st_ino, inode)

    def test_failed_install_restores_previous_bundle(self):
        with tempfile.TemporaryDirectory(prefix='datolens-bundle-test-') as temporary:
            root = Path(temporary)
            installed = root / 'installed/Datolens.app'
            installed.mkdir(parents=True)
            (installed / 'version').write_text('original')
            (root / 'staged').mkdir()
            with self.assertRaises(FileNotFoundError):
                bundle.install_bundle(root / 'staged/Datolens.app', installed)
            self.assertEqual((installed / 'version').read_text(), 'original')
            self.assertFalse((root / 'staged/PreviousDatolens.app').exists())

    def test_concurrent_builds_cannot_take_the_same_lock(self):
        with tempfile.TemporaryDirectory(prefix='datolens-bundle-test-') as temporary:
            with patch.object(bundle, 'TARGET', Path(temporary)):
                with bundle.build_lock():
                    with self.assertRaisesRegex(RuntimeError, 'Another macOS build'):
                        with bundle.build_lock():
                            self.fail('A second build acquired the lock')

    def test_direct_packaging_cannot_bypass_helper_preservation(self):
        with patch.dict(os.environ, {'CARGO_TARGET_DIR': str(bundle.TARGET)}):
            with patch.object(bundle, 'running_apps', return_value=[]):
                with self.assertRaisesRegex(RuntimeError, 'preserve the authorized credential helper'):
                    bundle.guard_bundle_destination()


if __name__ == '__main__':
    unittest.main()
