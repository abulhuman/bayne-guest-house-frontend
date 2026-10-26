# On-prem frontend deployment

Production is `https://manage.almishotel.com`, using `https://api.almishotel.com`. PR previews are `https://pr-N.almishotel.com`. Each frontend PR owns a separate API, Postgres volume, JWT key, database password, and generated test admin. The preview frontend calls `/api` on its own hostname. Traefik strips that prefix and routes to its private preview API. Production data and credentials never enter a preview.

The temporary deployment repository is https://github.com/abulhuman/bayne-guest-house-frontend. The original repository remains https://github.com/Jaal-moha/bayne-guest-house-frontend. Production deploys `v*` release tags on the temporary fork. Merging to `main` builds and tests without deploying. Each PR targeting `main` gets a preview. Changes in the original repository do not sync automatically.

## Existing host infrastructure

The backend deployment owns the `almis-main` stack, the `almis-edge` Docker network, Traefik, and the host's Cloudflare Tunnel. Both stacks run on the backend's deployment host. This repository joins that network. It does not create another connector or store another tunnel token. Keep the backend stack running.

Cloudflare hosts DNS for the Namecheap-registered domain. The existing remotely managed tunnel routes `api.almishotel.com` and `*.almishotel.com` to `http://edge:80`, followed by an HTTP 404 catch-all. The frontend manager creates a proxied CNAME for each published frontend hostname. It refuses to change records without its ownership comment. It does not create a wildcard DNS record or touch the public hotel's root or `www` records.

All preview names have one subdomain level, which Cloudflare Universal SSL covers. Names such as `pr-N.preview.almishotel.com` would require additional certificate coverage.

Docker binds the edge diagnostic port to `127.0.0.1:8080`. The frontend, APIs, and databases have no public host ports. The connector uses outbound connections.

## Host configuration

Prerequisites are Docker with Compose supporting `--wait`, Python 3.11 or newer, authenticated Cloudflare CLI, and GitHub CLI with admin permission on the temporary fork. Docker must be usable by the current host user.

```bash
python3 deploy/manage.py prepare
```

This installs manifests, the trusted deployment manager, the tutorial publisher `publish.mjs`, and public configuration into `~/.local/share/almis/frontend`. Existing configuration is preserved. Review `deploy.env` there before the first deployment. Directories are mode `0700` and generated environment files are mode `0600`.

- `APP_DOMAIN` is `manage.almishotel.com`.
- `NEXT_PUBLIC_API_BASE` is `https://api.almishotel.com` for production builds.
- `PREVIEW_DOMAIN` is `almishotel.com`.
- `BACKEND_IMAGE` pins the API image used by new frontend preview containers. Build or load that image on this host before deploying previews. Update it deliberately after testing backend changes.
- `~/.local/share/almis/tutorials` holds the tutorial stores. Set `ALMIS_TUTORIALS_ROOT` to use another directory. `main` is the production store, and `frontend-pr-N` belongs to frontend PR N. The backend owns `pr-N` in the same directory, because both stacks run on one host.
- `EDGE_NETWORK`, `CLOUDFLARE_ZONE`, and `CLOUDFLARE_TUNNEL_ID` identify the existing shared infrastructure.

Allow `https://manage.almishotel.com` in the production backend's `ALLOWED_ORIGINS` JSON array, then recreate the API container so it reads the changed environment. Preserve all existing origins and credentials. The frontend manager does not modify the backend's production configuration.

`NEXT_PUBLIC_API_BASE` is public and is compiled into the image. A production image must use the production API URL. A preview image must use `/api`. Setting it only at container runtime cannot change the browser bundle.

## Deploy manually

```bash
docker build --build-arg NEXT_PUBLIC_API_BASE=https://api.almishotel.com -t almis-frontend:main-check .
python3 ~/.local/share/almis/frontend/manage.py main --image almis-frontend:main-check

docker build --build-arg NEXT_PUBLIC_API_BASE=/api -t almis-frontend:preview-check .
python3 ~/.local/share/almis/frontend/manage.py preview --pr 42 --image almis-frontend:preview-check
python3 ~/.local/share/almis/frontend/manage.py remove-preview --pr 42

python3 ~/.local/share/almis/frontend/manage.py publish-tutorials --source .verify/demos --pr 42
python3 ~/.local/share/almis/frontend/manage.py publish-tutorials --source .verify/demos --main
```

The manager waits for healthy containers, runs pending migrations in the preview database, creates the preview admin, then publishes DNS. Re-deploying a PR preserves its database and credentials. Its generated login is stored in `~/.local/share/almis/frontend/previews/pr-N/admin.env`. Do not post that file in PR comments. Closing a PR removes its DNS record, containers, private network, database volume, credentials, and tutorial store. Image tags remain available for rollback and can be removed separately when no longer needed.

The frontend preview API mounts its `frontend-pr-N` store read-only at `/srv/tutorials`. When that store is absent, the manager first seeds it from `main` by hardlinking every regular file there, so a PR that re-records nothing still shows the production tutorials. It skips symlinks and directories, and it refuses a store that is itself a symlink. Seeding writes into a temporary directory and renames it into place, so a run that stops halfway leaves no partial store, and the next run starts over. An existing store is never seeded again. The publisher replaces files by rename and never writes into an existing file, so a PR's publishes never change `main`. Each preview generates its own HMAC key in `previews/pr-N/tutorials-signing-key` and reads it from `/run/secrets/tutorials-signing-key`. The API signs and checks its own media URLs, so a preview never holds the production key, and closing the PR deletes the key.

Publish recorded demos into a store with `control.sh publish <dir>`. It checks every video and poster digest before it copies anything, replaces media in the store that fails its digest, and keeps the replaced manifest as `manifest.previous.json`. `control.sh publish-rollback <dir>` swaps the two manifests, so running it again undoes the rollback. Unreferenced media is deleted after 7 days; media in either manifest is kept. On the host, `manage.py publish-tutorials --source DIR` runs the same publisher, from the copy installed next to `manage.py`, under the deployment lock. Pass `--pr N` to seed and publish into `frontend-pr-N`, or `--main` to publish into `main`. It accepts exactly one of the two. The demos workflow also passes `--order` with its run number. The store records, in `.publish-order.json`, the newest run that published each demo, and an older run's recording of that demo is skipped, so runs that finish out of order never put back an older video. Seeding a PR store skips dotfiles, so it starts without main's run numbers.

A failed deployment can leave containers for inspection and retry. DNS is published only after local health checks pass. The deployment lock serializes host mutations. To roll back production, re-run the workflow on an older tag with `gh workflow run "Deploy on-prem" --ref v1.3.0`, or pass a retained prior frontend image to `manage.py main`; production database migrations are owned by the backend deployment.

## GitHub Actions runner

```bash
python3 deploy/register-runner.py --repo abulhuman/bayne-guest-house-frontend --start
```

The installer downloads the official Linux x64 runner, verifies the release SHA-256 digest, registers it using a short-lived token passed privately, and starts `almis-frontend-runner.service` as a systemd user service. Its directory is `~/.local/share/almis/frontend-runner` and its custom label is `almis-frontend`.

On the current host, `almis` has no sudo and lingering is off, so `almis-frontend-runner.service` runs as a system unit with `User=almis`, written the same way as the backend's `almis-runner.service`. Check `loginctl show-user "$USER" -p Linger`. If lingering is disabled, a system administrator must enable it with `sudo loginctl enable-linger "$USER"` for the user service to start at boot and survive logout. Container restart policies recover the deployed application whenever Docker starts. The runner is needed for new deployments, not to keep deployed containers serving requests.

Enable Actions on the temporary fork. The workflow needs no repository secrets. Cloudflare CLI authentication and runtime credentials stay on the host.

GitHub-hosted runners run the existing tests and build the image. A PR image goes to GHCR as `ghcr.io/abulhuman/bayne-guest-house-frontend:pr-<n>-<sha>` with a GitHub Actions layer cache, and the on-prem runner pulls only the layers it lacks. A release builds its image on the on-prem runner from the tag's checkout, because the host's connection could not download even a 73 MB image artifact within the job limit. Closing a PR deletes its images from the host, and deletes every closed PR's images from GHCR except the newest, since GHCR refuses to delete a package's last tagged version. The on-prem runner checks that a PR is still open with the same head commit, or that `main` contains the release tag's commit, before deploying. A tag on any other commit fails without touching the host. It loads the image and invokes the installed deployment manager. PR jobs never check out or execute PR host scripts. Only a release updates those scripts. Deploy and cleanup jobs share a per-PR concurrency group and do not cancel running migrations.

To release, tag a `main` commit and push the tag:

```bash
git switch main && git pull --ff-only
git tag -a v1.4.0 -m "v1.4.0"
git push deployment v1.4.0
```

Same-repository contributors are trusted to run application containers. Fork PRs cannot deploy on this persistent host. Keep write access to the temporary fork limited to trusted maintainers and review workflow changes. Images, containers, and the shared edge host are not a sandbox for hostile code.

## Demo recordings

`.github/workflows/demos.yml` re-records the demos a change affects and publishes them. A PR from this repository records the demos that `control.sh affected` finds between the PR's merge base and its head, and publishes them into `frontend-pr-N`. A push to `main` records the pushed range and publishes into `main`. A manual run with `all` records every demo, and without it records the demos the last commit affects. A manual run publishes into `main` only when `main` contains its commit.

Hosted runners record in up to three shards, with no secrets and no host credentials. Each shard checks out the backend fork's `main` next to the frontend, as `control.sh` expects. A demo that fails has no media, so its shard bundle holds only the demos that passed. The `demos` job merges the shard bundles into one, so a single manifest replacement covers the run and `publish-rollback` undoes all of it. The `demos` check fails when any selected demo failed, and the passing demos still publish. A failed demo keeps its previous video.

The on-prem runner then checks that the PR is still open at the same head, or that `main` contains the pushed commit. It downloads the bundle and runs the installed `manage.py publish-tutorials`. It never checks out the repository. Its timeout is two hours, because the host's link once took more than 20 minutes for a 73 MB artifact, and a full run is about 60 MB. A truncated download fails the publisher's digest check and writes nothing. A PR gets one comment, updated on each run, that lists the re-recorded and failed demos and links to `https://pr-N.almishotel.com/help`.

Runs for one PR share a concurrency group, and a newer push cancels the older run, because the newer range covers the older one. PRs never share a group. Pushes to `main` never cancel or replace each other, since each records only its own range, and the deployment lock serializes their publishes. The deploy workflow is separate, so a failing demo never blocks a deploy.

## Verification

```bash
curl --fail -H 'Host: manage.almishotel.com' http://127.0.0.1:8080/login
curl --fail https://manage.almishotel.com/login
curl --fail -H 'Host: pr-42.almishotel.com' http://127.0.0.1:8080/api/health
curl --fail https://pr-42.almishotel.com/api/health
systemctl --user status almis-frontend-runner.service
```

Check production CORS with an `Origin: https://manage.almishotel.com` request to the production API. Test a preview login using its generated credentials and confirm the preview database volume and JWT key differ from production and other previews. Never dump environment files, Compose configuration, or full Docker inspection output into shared logs.

## Returning to the original repository

Once admin access is available on the original repository, move these deployment commits there, disable Actions on the temporary fork, stop and remove the fork's runner registration, and register the host runner against the original repository. Both repositories must not deploy production concurrently. The host configuration, DNS, tunnel, and existing production database can stay in place. The installer deliberately refuses to silently reuse a registration belonging to another repository.

## Secrets and Doppler

Doppler is optional for this single-host setup. Private host files are sufficient
to run it. A secrets manager becomes useful for shared administration, audited
changes, rotation, and recovery. Keep an encrypted off-machine backup of production
secrets; a secrets manager does not back up the Postgres database.

If adopting Doppler, separate production, preview, and infrastructure access.

| Secret | Scope | Current location or handling |
| --- | --- | --- |
| `POSTGRES_PASSWORD`, `DATABASE_URL`, `DIRECT_URL` | Production backend | `~/.local/share/almis/deploy/.env.production` |
| `JWT_SECRET` | Production backend | Same backend environment file |
| Cloudflare Tunnel token | Host connector only | Existing backend connector credential file |
| Cloudflare DNS API credential | Host deployment process only | Existing authenticated `cf` profile; use a zone-scoped DNS token for unattended automation if replacing login |
| Preview database passwords and URLs, `JWT_SECRET` | One PR only | Generated in `~/.local/share/almis/frontend/previews/pr-N/.env` |
| Preview admin password | One PR only | Generated in that PR's `admin.env` |
| GitHub runner identity | Host runner only | Managed by GitHub's runner in its private directory |

The runner registration token is short-lived and does not need permanent storage.
Do not give application containers the Cloudflare credential or runner credentials.
Do not reuse production secrets in previews. Ephemeral PR credentials can remain
host-generated rather than creating a Doppler configuration for every PR.

`NEXT_PUBLIC_API_BASE`, hostnames, zone/tunnel IDs, and image tags are public
configuration. They do not need secret storage. No repository Actions secrets are
required by this workflow, and no application secret belongs in `NEXT_PUBLIC_*`.

## Dependency status

The deployment update moves Next.js and its ESLint configuration from 15.4.6 to
15.5.28 and refreshes compatible dependency fixes. On 2026-10-17,
`npm audit --omit=dev` reports no critical findings and two remaining entries:
a high-severity PostCSS dependency and a moderate Next.js entry caused by that
dependency. The suggested complete fix requires Next.js 16, which needs separate
migration testing. Development tooling also has unresolved advisories. No forced
major dependency upgrade was applied.
