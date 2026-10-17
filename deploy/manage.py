#!/usr/bin/env python3
"""Deploy the frontend through the existing on-prem edge and tunnel."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess

DEFAULT_ROOT = Path.home() / '.local/share/bayne/frontend'


def read_env(path):
    if not path.exists():
        return {}
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith('#') and '=' in line)


def write_env(path, values):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w') as output:
        os.chmod(temporary, 0o600)
        for key, value in values.items():
            if '\n' in str(value) or '\r' in str(value):
                raise ValueError(f'{key} must be a single line')
            output.write(f'{key}={value}\n')
    temporary.replace(path)
    os.chmod(path, 0o600)


def cf(*args):
    result = subprocess.run(['cf', *args], capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError('Cloudflare command failed: ' + ' '.join(args[:3]))
    return json.loads(result.stdout)


def publish_dns(config, hostname, remove=False):
    zone = config['CLOUDFLARE_ZONE']
    target = config['CLOUDFLARE_TUNNEL_ID'] + '.cfargotunnel.com'
    marker = 'bayne-frontend:' + hostname
    records = cf('dns', 'records', 'list', '--zone', zone, '--name', hostname)
    if records:
        if any(r['type'] != 'CNAME' or r['content'] != target or
               r.get('comment') != marker or not r.get('proxied') for r in records):
            raise RuntimeError('DNS name belongs to another configuration: ' + hostname)
        if remove:
            for record in records:
                cf('dns', 'records', 'delete', record['id'], '--zone', zone, '--force')
    elif not remove:
        body = json.dumps(dict(type='CNAME', name=hostname, content=target,
                               proxied=True, ttl=1, comment=marker))
        cf('dns', 'records', 'create', '--zone', zone, '--body', body, '--dry-run')
        cf('dns', 'records', 'create', '--zone', zone, '--body', body)


def preview_environment(path, hostname):
    values = read_env(path)
    # Generate from scratch. Never import production or backend preview secrets.
    values.setdefault('POSTGRES_USER', 'preview')
    values.setdefault('POSTGRES_DB', 'preview')
    values.setdefault('POSTGRES_PASSWORD', secrets.token_hex(32))
    url = (f"postgresql://{values['POSTGRES_USER']}:{values['POSTGRES_PASSWORD']}"
           f"@db:5432/{values['POSTGRES_DB']}?schema=public")
    values.setdefault('DATABASE_URL', url)
    values.setdefault('DIRECT_URL', url)
    values.setdefault('JWT_SECRET', secrets.token_hex(48))
    values.setdefault('JWT_EXPIRES_IN', '3600')
    values['ALLOWED_ORIGINS'] = json.dumps(['https://' + hostname])
    write_env(path, values)
    return values


def bootstrap_preview_admin(compose, environment, path):
    credentials = read_env(path)
    credentials.setdefault('ADMIN_EMAIL', 'admin@preview.invalid')
    credentials.setdefault('ADMIN_PASSWORD', secrets.token_urlsafe(24))
    write_env(path, credentials)
    # Pass the credential via stdin, never a command argument or shared log.
    code = """
const {PrismaClient} = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const credentials = CREDENTIALS;
  await prisma.user.upsert({where: {email: credentials.ADMIN_EMAIL}, update: {},
    create: {name: 'Preview admin', email: credentials.ADMIN_EMAIL,
      password: await bcrypt.hash(credentials.ADMIN_PASSWORD, 10), role: 'admin',
      forceChangePassword: false}});
})().finally(() => prisma.$disconnect());
""".replace('CREDENTIALS', json.dumps(credentials))
    subprocess.run(compose + ['exec', '-T', 'api', 'node'], env=environment,
                   input=code, text=True, check=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'main', 'preview', 'remove-preview'])
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--image')
    parser.add_argument('--pr', type=int)
    args = parser.parse_args()
    if args.action in ('main', 'preview') and not args.image:
        parser.error('--image is required')
    if args.action in ('preview', 'remove-preview') and (args.pr is None or args.pr < 1):
        parser.error('--pr must be positive')
    if args.image and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]*', args.image):
        parser.error('Invalid image reference')
    root = args.root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        source = Path(__file__).resolve().parent
        if args.action == 'prepare':
            for name in ('compose.yml', 'compose.preview.yml', 'manage.py'):
                if source / name != root / name:
                    shutil.copyfile(source / name, root / name)
            config_file = root / 'deploy.env'
            if not config_file.exists():
                write_env(config_file, read_env(source / 'deploy.env.example'))
            print(f'Prepared {root}; existing configuration preserved.')
            return
        config = read_env(root / 'deploy.env')
        for key in ('APP_DOMAIN', 'PREVIEW_DOMAIN', 'CLOUDFLARE_ZONE', 'CLOUDFLARE_TUNNEL_ID', 'BACKEND_IMAGE'):
            if not config.get(key):
                parser.error(f'{key} is missing from {root / "deploy.env"}')
        for key in ('APP_DOMAIN', 'PREVIEW_DOMAIN', 'CLOUDFLARE_ZONE'):
            if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}', config[key]):
                parser.error(f'Invalid hostname in {key}')
        # Do not inherit Compose substitutions or secrets from a caller's shell.
        environment = {k: v for k, v in os.environ.items()
                       if not k.startswith(('COMPOSE_', 'POSTGRES_', 'PREVIEW_')) and
                       k not in ('APP_IMAGE', 'PR_NUMBER', 'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET')}
        environment.update(config)
        hostname = config['APP_DOMAIN']
        if args.action == 'main':
            compose = ['docker', 'compose', '--project-directory', str(root),
                       '--env-file', str(root / 'deploy.env'), '-f', str(root / 'compose.yml')]
        else:
            hostname = f'pr-{args.pr}.' + config['PREVIEW_DOMAIN']
            preview_root = root / f'previews/pr-{args.pr}'
            env_file = preview_root / '.env'
            if args.action == 'remove-preview' and not env_file.exists():
                publish_dns(config, hostname, remove=True)
                print(f'Preview {args.pr} already absent.')
                return
            preview_environment(env_file, hostname)
            environment.update(PR_NUMBER=str(args.pr), PREVIEW_HOST=hostname,
                               PREVIEW_ENV_FILE=str(env_file))
            compose = ['docker', 'compose', '--project-directory', str(root),
                       '--env-file', str(root / 'deploy.env'), '--env-file', str(env_file),
                       '-p', f'bayne-fe-pr-{args.pr}', '-f', str(root / 'compose.preview.yml')]
        environment['APP_IMAGE'] = args.image or 'unused'
        if args.action == 'remove-preview':
            publish_dns(config, hostname, remove=True)
            subprocess.run(compose + ['down', '--volumes', '--remove-orphans'],
                           env=environment, check=True)
            shutil.rmtree(preview_root)
            print(f'Removed preview {args.pr} and its disposable database.')
            return
        subprocess.run(['docker', 'network', 'inspect', config.get('EDGE_NETWORK', 'almis-edge')],
                       stdout=subprocess.DEVNULL, env=environment, check=True)
        subprocess.run(compose + ['up', '-d', '--wait', '--wait-timeout', '240'],
                       env=environment, check=True)
        if args.action == 'preview':
            bootstrap_preview_admin(compose, environment, preview_root / 'admin.env')
        publish_dns(config, hostname)
        write_env(root / ('main.env' if args.action == 'main' else f'previews/pr-{args.pr}/image.env'),
                  {'APP_IMAGE': args.image})
        print('Healthy deployment at https://' + hostname)


if __name__ == '__main__':
    main()
