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


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_source(source, video=b'video bytes', poster=b'poster bytes', name='demo', sha256=None, poster_name=None):
    source.mkdir(parents=True, exist_ok=True)
    video_name = f'{name}.{digest(video)[:16]}.mp4'
    poster_name = poster_name or f'{name}.{digest(poster)[:16]}.jpg'
    (source / video_name).write_bytes(video)
    (source / poster_name).write_bytes(poster)
    manifest = {'version': 1, 'tutorials': [{
        'name': name, 'title': 'Demo', 'summary': 'Demo', 'group': 'reception',
        'primaryRole': 'reception', 'audience': ['reception'], 'pages': ['/bookings'],
        'durationSec': 1, 'video': video_name, 'poster': poster_name,
        'sha256': sha256 or digest(video), 'recordedAt': '2026-10-18T00:00:00Z', 'sourceCommit': 'a' * 40,
    }]}
    (source / 'manifest.json').write_text(json.dumps(manifest) + '\n')
    return video_name, poster_name


def run(*args, source=None):
    env = {**os.environ, 'PUBLISH_SOURCE': str(source)} if source else os.environ
    return subprocess.run([str(CONTROL), *args], cwd=ROOT, env=env, text=True, capture_output=True)


def snapshot(target):
    return {path.name: path.read_bytes() for path in target.iterdir()}


class PublishTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.source = Path(directory.name) / 'source'
        self.target = Path(directory.name) / 'target'
        self.target.mkdir()

    def published(self):
        return json.loads((self.target / 'manifest.json').read_text())['tutorials']

    def test_publish_is_idempotent_and_merges_manifest(self):
        write_source(self.source)
        self.assertEqual(run('publish', str(self.target), source=self.source).returncode, 0)
        before = snapshot(self.target)
        self.assertEqual(run('publish', str(self.target), source=self.source).returncode, 0)
        self.assertEqual(before, snapshot(self.target))

    def test_publish_keeps_recent_unreferenced_media_and_removes_old(self):
        write_source(self.source)
        old = self.target / 'old.aaaaaaaaaaaaaaaa.mp4'
        recent = self.target / 'recent.bbbbbbbbbbbbbbbb.jpg'
        old.write_bytes(b'old')
        recent.write_bytes(b'recent')
        stale = time.time() - 8 * 24 * 60 * 60
        os.utime(old, (stale, stale))
        self.assertEqual(run('publish', str(self.target), source=self.source).returncode, 0)
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())

    def test_video_digest_mismatch_copies_nothing(self):
        write_source(self.source, sha256='0' * 64)
        result = run('publish', str(self.target), source=self.source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('digest mismatch', result.stderr)
        self.assertEqual(snapshot(self.target), {})

    def test_poster_that_does_not_match_its_name_copies_nothing(self):
        write_source(self.source, poster_name='demo.cccccccccccccccc.jpg')
        result = run('publish', str(self.target), source=self.source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('digest mismatch', result.stderr)
        self.assertEqual(snapshot(self.target), {})

    def test_corrupt_media_already_in_target_is_replaced(self):
        video_name, poster_name = write_source(self.source)
        (self.target / video_name).write_bytes(b'trunc')
        self.assertEqual(run('publish', str(self.target), source=self.source).returncode, 0)
        self.assertEqual((self.target / video_name).read_bytes(), b'video bytes')
        self.assertEqual((self.target / poster_name).read_bytes(), b'poster bytes')

    def test_rollback_restores_previous_manifest_and_keeps_its_media(self):
        first_video, first_poster = write_source(self.source / 'first')
        self.assertEqual(run('publish', str(self.target), source=self.source / 'first').returncode, 0)
        stale = time.time() - 8 * 24 * 60 * 60
        for name in (first_video, first_poster):
            os.utime(self.target / name, (stale, stale))
        second_video, _ = write_source(self.source / 'second', video=b'new video', poster=b'new poster')
        self.assertEqual(run('publish', str(self.target), source=self.source / 'second').returncode, 0)
        self.assertEqual(self.published()[0]['video'], second_video)
        self.assertTrue((self.target / first_video).exists())

        result = run('publish-rollback', str(self.target))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.published()[0]['video'], first_video)
        self.assertEqual((self.target / first_video).read_bytes(), b'video bytes')

    def test_rollback_without_previous_manifest_fails(self):
        write_source(self.source)
        self.assertEqual(run('publish', str(self.target), source=self.source).returncode, 0)
        before = snapshot(self.target)
        self.assertNotEqual(run('publish-rollback', str(self.target)).returncode, 0)
        self.assertEqual(before, snapshot(self.target))


if __name__ == '__main__':
    unittest.main()
