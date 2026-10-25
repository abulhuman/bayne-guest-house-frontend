#!/usr/bin/env python3
"""Register a dedicated frontend runner with a short-lived GitHub token."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request


def github(path, method='GET'):
    result = subprocess.run(['gh', 'api', '--method', method, path], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('GitHub refused runner registration. Repository admin access is required. No token was displayed.')
    return json.loads(result.stdout)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='abulhuman/bayne-guest-house-frontend')
    parser.add_argument('--start', action='store_true', help='Install and start a systemd user service')
    args = parser.parse_args()
    root = Path.home() / '.local/share/almis/frontend-runner'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not (root / '.runner').exists():
        # Check permissions before downloading; obtain the short-lived token only
        # after the archive is ready so a slow download cannot expire it.
        github(f'repos/{args.repo}/actions/runners')
        release = github('repos/actions/runner/releases/latest')
        asset = next(a for a in release['assets'] if a['name'].startswith('actions-runner-linux-x64-') and a['name'].endswith('.tar.gz'))
        digest = asset.get('digest', '')
        if not digest.startswith('sha256:'):
            raise SystemExit('The official runner release has no SHA-256 digest.')
        archive = root / asset['name']
        if not archive.exists():
            print('Downloading the official GitHub runner...', flush=True)
            partial = archive.with_suffix('.part')
            with urllib.request.urlopen(asset['browser_download_url'], timeout=60) as source, partial.open('wb') as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
            partial.replace(archive)
        with archive.open('rb') as downloaded:
            actual = hashlib.file_digest(downloaded, 'sha256').hexdigest()
        if actual != digest.removeprefix('sha256:'):
            raise SystemExit('Runner download checksum failed.')
        with tarfile.open(archive) as package:
            package.extractall(root, filter='data')
        registration = github(f'repos/{args.repo}/actions/runners/registration-token', 'POST')
        environment = {**os.environ, 'ACTIONS_RUNNER_INPUT_TOKEN': registration['token']}
        subprocess.run([str(root / 'config.sh'), '--unattended', '--url', f'https://github.com/{args.repo}',
                        '--name', 'almis-frontend-onprem', '--labels', 'almis-frontend', '--work', '_work'],
                       cwd=root, env=environment, check=True)
        archive.unlink()
    else:
        registered = json.loads((root / '.runner').read_text())
        if registered.get('gitHubUrl', '').rstrip('/') != f'https://github.com/{args.repo}':
            raise SystemExit('Runner belongs to another repository. Remove its registration before moving it.')
    if args.start:
        directory = Path.home() / '.local/share/systemd/user'
        directory.mkdir(parents=True, exist_ok=True)
        unit = directory / 'almis-frontend-runner.service'
        unit.write_text(f'''[Unit]
Description=Almis frontend GitHub Actions runner
After=network-online.target
[Service]
WorkingDirectory={root}
ExecStart={root}/run.sh
Environment="PATH={os.environ['PATH']}"
Restart=always
RestartSec=10
KillSignal=SIGINT
TimeoutStopSec=120
[Install]
WantedBy=default.target
''')
        subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
        subprocess.run(['systemctl', '--user', 'enable', '--now', unit.name], check=True)
        print('Installed and started almis-frontend-runner.service.')
    else:
        print('Registered. Start with ' + str(root / 'run.sh'))


if __name__ == '__main__':
    main()
