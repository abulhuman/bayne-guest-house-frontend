import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('deployment', ROOT / 'manage.py')
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class TutorialPreviewTests(unittest.TestCase):
    def test_preview_compose_mounts_read_only_tutorial_store(self):
        text = (ROOT / 'compose.preview.yml').read_text()
        self.assertIn('${TUTORIALS_HOST_DIR:?TUTORIALS_HOST_DIR is required}:/srv/tutorials:ro', text)
        self.assertIn('TUTORIALS_DIR: /srv/tutorials', text)
        self.assertIn('TUTORIALS_SIGNING_SECRET_FILE: /run/secrets/tutorials-signing-key', text)

    def test_pr_store_falls_back_to_main(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'tutorials'
            main = root / 'main'
            main.mkdir(parents=True)
            key = Path(directory) / 'key'
            key.write_text('secret')
            with patch.dict('os.environ', {'ALMIS_TUTORIALS_ROOT': str(root), 'ALMIS_TUTORIALS_SIGNING_KEY': str(key)}):
                selected, selected_key = deployment.tutorial_paths(42)
            self.assertEqual(selected, main)
            self.assertEqual(selected_key, key)


if __name__ == '__main__':
    unittest.main()
