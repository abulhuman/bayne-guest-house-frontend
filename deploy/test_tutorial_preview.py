import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('deployment', ROOT / 'manage.py')
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class TutorialPreviewTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.root = self.directory / 'tutorials'
        environment = patch.dict('os.environ', {'ALMIS_TUTORIALS_ROOT': str(self.root), 'HOME': str(self.directory)})
        environment.start()
        self.addCleanup(environment.stop)

    def test_preview_compose_mounts_read_only_tutorial_store(self):
        text = (ROOT / 'compose.preview.yml').read_text()
        self.assertIn('${TUTORIALS_HOST_DIR:?TUTORIALS_HOST_DIR is required}:/srv/tutorials:ro', text)
        self.assertIn('TUTORIALS_DIR: /srv/tutorials', text)
        self.assertIn('TUTORIALS_SIGNING_SECRET_FILE: /run/secrets/tutorials-signing-key', text)

    def test_pr_store_falls_back_to_main(self):
        selected, _ = deployment.tutorial_paths(42, self.directory / 'previews/pr-42')
        self.assertEqual(selected, self.root / 'main')
        (self.root / 'pr-42').mkdir()
        selected, _ = deployment.tutorial_paths(42, self.directory / 'previews/pr-42')
        self.assertEqual(selected, self.root / 'main', 'pr-42 belongs to backend PR 42')
        (self.root / 'frontend-pr-42').mkdir()
        selected, _ = deployment.tutorial_paths(42, self.directory / 'previews/pr-42')
        self.assertEqual(selected, self.root / 'frontend-pr-42')

    def test_each_preview_gets_its_own_private_signing_key(self):
        _, first = deployment.tutorial_paths(1, self.directory / 'previews/pr-1')
        _, again = deployment.tutorial_paths(1, self.directory / 'previews/pr-1')
        _, second = deployment.tutorial_paths(2, self.directory / 'previews/pr-2')
        self.assertEqual(first, self.directory / 'previews/pr-1/tutorials-signing-key')
        self.assertEqual(first.read_text(), again.read_text())
        self.assertNotEqual(first.read_text(), second.read_text())
        self.assertGreaterEqual(len(first.read_text().strip()), 64)
        self.assertEqual(stat.S_IMODE(first.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
