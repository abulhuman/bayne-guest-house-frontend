import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).parents[1]
CONTROL = ROOT / '.claude/skills/verify/scripts/control.sh'


class PublishTests(unittest.TestCase):
    def test_publish_is_idempotent_and_merges_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            target = Path(directory) / 'target'
            source.mkdir()
            target.mkdir()
            video = b'video bytes'
            (source / 'demo.aaaaaaaaaaaaaaaa.mp4').write_bytes(video)
            (source / 'demo.bbbbbbbbbbbbbbbb.jpg').write_bytes(b'poster bytes')
            manifest = {'version': 1, 'tutorials': [{
                'name': 'demo', 'title': 'Demo', 'summary': 'Demo', 'group': 'reception',
                'primaryRole': 'reception', 'audience': ['reception'], 'pages': ['/bookings'],
                'durationSec': 1, 'video': 'demo.aaaaaaaaaaaaaaaa.mp4', 'poster': 'demo.bbbbbbbbbbbbbbbb.jpg',
                'sha256': hashlib.sha256(video).hexdigest(), 'recordedAt': '2026-10-18T00:00:00Z', 'sourceCommit': 'a' * 40,
            }]}
            (source / 'manifest.json').write_text(json.dumps(manifest) + '\n')
            env = {**os.environ, 'PUBLISH_SOURCE': str(source)}
            subprocess.run([str(CONTROL), 'publish', str(target)], cwd=ROOT, env=env, check=True, text=True, capture_output=True)
            before = {path.name: path.read_bytes() for path in target.iterdir()}
            subprocess.run([str(CONTROL), 'publish', str(target)], cwd=ROOT, env=env, check=True, text=True, capture_output=True)
            self.assertEqual(before, {path.name: path.read_bytes() for path in target.iterdir()})

    def test_publish_keeps_recent_unreferenced_media_and_removes_old(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'
            target = Path(directory) / 'target'
            source.mkdir()
            target.mkdir()
            (source / 'demo.aaaaaaaaaaaaaaaa.mp4').write_bytes(b'v')
            (source / 'demo.bbbbbbbbbbbbbbbb.jpg').write_bytes(b'p')
            sha = hashlib.sha256(b'v').hexdigest()
            (source / 'manifest.json').write_text(json.dumps({'version': 1, 'tutorials': [{
                'name': 'demo', 'title': 'Demo', 'summary': 'Demo', 'group': 'g', 'primaryRole': 'reception',
                'audience': ['reception'], 'pages': ['/bookings'], 'durationSec': 1,
                'video': 'demo.aaaaaaaaaaaaaaaa.mp4', 'poster': 'demo.bbbbbbbbbbbbbbbb.jpg', 'sha256': sha,
                'recordedAt': '2026-10-18T00:00:00Z', 'sourceCommit': 'a' * 40,
            }]}))
            old = target / 'old.aaaaaaaaaaaaaaaa.mp4'
            recent = target / 'recent.bbbbbbbbbbbbbbbb.jpg'
            old.write_bytes(b'old')
            recent.write_bytes(b'recent')
            stale = time.time() - 8 * 24 * 60 * 60
            os.utime(old, (stale, stale))
            env = {**os.environ, 'PUBLISH_SOURCE': str(source)}
            subprocess.run([str(CONTROL), 'publish', str(target)], cwd=ROOT, env=env, check=True, text=True, capture_output=True)
            self.assertFalse(old.exists())
            self.assertTrue(recent.exists())


if __name__ == '__main__':
    unittest.main()
