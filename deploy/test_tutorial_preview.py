import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deployment = load('deployment', 'manage.py')
write_source = load('publish_tests', 'test_publish.py').write_source


def files(directory):
    return {path.name: (path.lstat().st_ino, path.read_bytes()) for path in directory.iterdir()
            if stat.S_ISREG(path.lstat().st_mode)}


class StoreCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.root = self.directory / 'tutorials'
        self.main = self.root / 'main'
        self.main.mkdir(parents=True)
        for name in ('manifest.json', 'manifest.previous.json', 'demo.0123456789abcdef.mp4'):
            (self.main / name).write_text(name)
        environment = patch.dict('os.environ', {'ALMIS_TUTORIALS_ROOT': str(self.root), 'HOME': str(self.directory)})
        environment.start()
        self.addCleanup(environment.stop)


class TutorialStoreTests(StoreCase):
    def test_preview_compose_mounts_read_only_tutorial_store(self):
        text = (ROOT / 'compose.preview.yml').read_text()
        self.assertIn('${TUTORIALS_HOST_DIR:?TUTORIALS_HOST_DIR is required}:/srv/tutorials:ro', text)
        self.assertIn('TUTORIALS_DIR: /srv/tutorials', text)
        self.assertIn('TUTORIALS_SIGNING_SECRET_FILE: /run/secrets/tutorials-signing-key', text)

    def test_pr_store_is_seeded_from_main_by_hardlink(self):
        (self.root / 'pr-42').mkdir()
        outside = self.directory / 'outside.mp4'
        outside.write_text('outside')
        (self.main / 'linked.0123456789abcdef.mp4').symlink_to(outside)
        (self.main / 'nested').mkdir()
        store = deployment.tutorial_store(42)
        self.assertEqual(store, self.root / 'frontend-pr-42', 'pr-42 belongs to backend PR 42')
        self.assertEqual(sorted(os.listdir(store)), ['demo.0123456789abcdef.mp4', 'manifest.json', 'manifest.previous.json'])
        self.assertEqual(files(store), files(self.main), 'same inodes and bytes as main')

    def test_seeding_recovers_from_an_interrupted_run_and_never_reseeds(self):
        partial = self.root / '.frontend-pr-42.seeding'
        partial.mkdir()
        (partial / 'half-copied.mp4').write_text('junk')
        store = deployment.tutorial_store(42)
        self.assertNotIn('half-copied.mp4', files(store))
        (store / 'pr-only.fedcba9876543210.mp4').write_text('pr')
        (self.main / 'later.fedcba9876543210.mp4').write_text('later')
        before = files(store)
        self.assertEqual(deployment.tutorial_store(42), store)
        self.assertEqual(files(store), before)

    def test_symlinked_pr_store_is_refused(self):
        elsewhere = self.directory / 'elsewhere'
        elsewhere.mkdir()
        (self.root / 'frontend-pr-42').symlink_to(elsewhere)
        with self.assertRaisesRegex(RuntimeError, 'symlinked'):
            deployment.tutorial_store(42)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_each_preview_gets_its_own_private_signing_key(self):
        first = deployment.signing_key(self.directory / 'previews/pr-1')
        again = deployment.signing_key(self.directory / 'previews/pr-1')
        second = deployment.signing_key(self.directory / 'previews/pr-2')
        self.assertEqual(first, self.directory / 'previews/pr-1/tutorials-signing-key')
        self.assertEqual(first.read_text(), again.read_text())
        self.assertNotEqual(first.read_text(), second.read_text())
        self.assertGreaterEqual(len(first.read_text().strip()), 64)
        self.assertEqual(stat.S_IMODE(first.stat().st_mode), 0o600)


class PreviewLifecycleTests(StoreCase):
    def setUp(self):
        super().setUp()
        self.frontend = self.directory / 'frontend'
        deployment.write_env(self.frontend / 'deploy.env', {
            'APP_DOMAIN': 'manage.almishotel.com', 'PREVIEW_DOMAIN': 'almishotel.com',
            'CLOUDFLARE_ZONE': 'almishotel.com', 'CLOUDFLARE_TUNNEL_ID': 'tunnel', 'BACKEND_IMAGE': 'api:1'})
        for target, value in (('publish_dns', None), ('bootstrap_preview_admin', None)):
            patcher = patch.object(deployment, target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        docker = patch.object(deployment.subprocess, 'run')
        self.docker = docker.start()
        self.addCleanup(docker.stop)

    def manage(self, *args):
        with patch.object(sys, 'argv', ['manage.py', *args, '--root', str(self.frontend)]), \
                contextlib.redirect_stdout(io.StringIO()):
            deployment.main()

    def test_preview_always_mounts_its_own_store(self):
        self.manage('preview', '--pr', '42', '--image', 'almis-frontend:pr-42')
        mounted = {call.kwargs['env'].get('TUTORIALS_HOST_DIR') for call in self.docker.call_args_list}
        self.assertEqual(mounted, {str(self.root / 'frontend-pr-42')})

    def test_remove_preview_deletes_the_pr_store_and_never_main(self):
        before = files(self.main)
        for deployed in (True, False):
            deployment.tutorial_store(42)
            if deployed:
                self.manage('preview', '--pr', '42', '--image', 'almis-frontend:pr-42')
            self.manage('remove-preview', '--pr', '42')
            self.assertFalse((self.root / 'frontend-pr-42').exists(), f'deployed={deployed}')
            self.assertEqual(files(self.main), before)


class PublishTutorialsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.tutorials = self.directory / 'tutorials'
        self.installed = self.directory / 'frontend'
        self.environment = {**os.environ, 'ALMIS_TUTORIALS_ROOT': str(self.tutorials), 'HOME': str(self.directory)}
        prepared = self.manage(ROOT / 'manage.py', 'prepare')
        self.assertEqual(prepared.returncode, 0, prepared.stderr)

    def manage(self, script, *args):
        return subprocess.run([sys.executable, str(script), *args, '--root', str(self.installed)],
                              env=self.environment, text=True, capture_output=True)

    def publish(self, *args):
        return self.manage(self.installed / 'manage.py', 'publish-tutorials', *args)

    def names(self, store):
        return [tutorial['name'] for tutorial in json.loads((store / 'manifest.json').read_text())['tutorials']]

    def test_pr_publish_seeds_from_main_and_leaves_main_untouched(self):
        write_source(self.directory / 'old', name='laundry')
        self.assertEqual(self.publish('--source', str(self.directory / 'old'), '--main').returncode, 0)
        main = self.tutorials / 'main'
        before = files(main)
        write_source(self.directory / 'new', video=b'new video', poster=b'new poster', name='rooms')
        result = self.publish('--source', str(self.directory / 'new'), '--pr', '7')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.names(self.tutorials / 'frontend-pr-7'), ['laundry', 'rooms'])
        self.assertEqual(files(main), before)

    def test_main_publish_creates_no_pr_store(self):
        write_source(self.directory / 'bundle')
        result = self.publish('--source', str(self.directory / 'bundle'), '--main')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.names(self.tutorials / 'main'), ['demo'])
        self.assertEqual(sorted(path.name for path in self.tutorials.iterdir()), ['main'])

    def test_runs_the_publisher_installed_next_to_the_manager(self):
        (self.installed / 'publish.mjs').write_text("console.log('INSTALLED ' + process.argv.slice(2).join(' '));\n")
        write_source(self.directory / 'bundle')
        result = self.publish('--source', str(self.directory / 'bundle'), '--pr', '7')
        self.assertEqual(result.stdout.strip(),
                         f"INSTALLED publish {(self.directory / 'bundle').resolve()} {self.tutorials / 'frontend-pr-7'}")

    def test_invalid_arguments_publish_nothing(self):
        write_source(self.directory / 'bundle')
        bundle = str(self.directory / 'bundle')
        for args in (['--source', bundle], ['--source', bundle, '--pr', '7', '--main'],
                     ['--source', bundle, '--pr', '0'], ['--source', str(self.directory / 'missing'), '--main'],
                     ['--pr', '7']):
            result = self.publish(*args)
            self.assertEqual(result.returncode, 2, args)
        for args in (['preview', '--pr', '7', '--image', 'x', '--source', bundle], ['remove-preview', '--pr', '7', '--main']):
            self.assertEqual(self.manage(self.installed / 'manage.py', *args).returncode, 2, args)
        self.assertFalse(self.tutorials.exists())


if __name__ == '__main__':
    unittest.main()
