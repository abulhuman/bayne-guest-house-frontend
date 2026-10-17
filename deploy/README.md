# On-prem frontend deployment

Production is `https://manage.almishotel.com`, using `https://api.almishotel.com`. PR previews are `https://pr-N.almishotel.com`. Each frontend PR owns a separate API, Postgres volume, JWT key, database password, and generated test admin. The preview frontend calls `/api` on its own hostname. Traefik strips that prefix and routes to its private preview API. Production data and credentials never enter a preview.

The temporary deployment repository is https://github.com/abulhuman/bayne-guest-house-frontend. The original repository remains https://github.com/Jaal-moha/bayne-guest-house-frontend. Deployments currently follow the temporary fork's `main` and PRs targeting that branch. Changes in the original repository do not sync automatically.

## Existing host infrastructure

The backend deployment owns the `almis-main` stack, the `almis-edge` Docker network, Traefik, and the `almis-onprem` Cloudflare Tunnel. This repository joins that network. It does not create another connector or store another tunnel token. Keep the backend stack running.

Cloudflare hosts DNS for the Namecheap-registered domain. The existing remotely managed tunnel routes `api.almishotel.com` and `*.almishotel.com` to `http://edge:80`, followed by an HTTP 404 catch-all. The frontend manager creates a proxied CNAME for each published frontend hostname. It refuses to change records without its ownership comment. It does not create a wildcard DNS record or touch the public hotel's root or `www` records.

All preview names have one subdomain level, which Cloudflare Universal SSL covers. Names such as `pr-N.preview.almishotel.com` would require additional certificate coverage.

Docker binds the edge diagnostic port to `127.0.0.1:8080`. The frontend, APIs, and databases have no public host ports. The connector uses outbound connections.

## Host configuration

Prerequisites are Docker with Compose supporting `--wait`, Python 3.11 or newer, authenticated Cloudflare CLI, and GitHub CLI with admin permission on the temporary fork. Docker must be usable by the current host user.

```bash
python3 deploy/manage.py prepare
```

This installs manifests, the trusted deployment manager, and public configuration into `~/.local/share/bayne/frontend`. Existing configuration is preserved. Review `deploy.env` there before the first deployment. Directories are mode `0700` and generated environment files are mode `0600`.

- `APP_DOMAIN` is `manage.almishotel.com`.
- `NEXT_PUBLIC_API_BASE` is `https://api.almishotel.com` for production builds.
- `PREVIEW_DOMAIN` is `almishotel.com`.
- `BACKEND_IMAGE` pins the API image used by new frontend preview containers. Build or load that image on this host before deploying previews. Update it deliberately after testing backend changes.
- `EDGE_NETWORK`, `CLOUDFLARE_ZONE`, and `CLOUDFLARE_TUNNEL_ID` identify the existing shared infrastructure.

Allow `https://manage.almishotel.com` in the production backend's `ALLOWED_ORIGINS` JSON array, then recreate the API container so it reads the changed environment. Preserve all existing origins and credentials. The frontend manager does not modify the backend's production configuration.

`NEXT_PUBLIC_API_BASE` is public and is compiled into the image. A production image must use the production API URL. A preview image must use `/api`. Setting it only at container runtime cannot change the browser bundle.

## Deploy manually

```bash
docker build --build-arg NEXT_PUBLIC_API_BASE=https://api.almishotel.com -t bayne-frontend:main-check .
python3 ~/.local/share/bayne/frontend/manage.py main --image bayne-frontend:main-check

docker build --build-arg NEXT_PUBLIC_API_BASE=/api -t bayne-frontend:preview-check .
python3 ~/.local/share/bayne/frontend/manage.py preview --pr 42 --image bayne-frontend:preview-check
python3 ~/.local/share/bayne/frontend/manage.py remove-preview --pr 42
```

The manager waits for healthy containers, runs pending migrations in the preview database, creates the preview admin, then publishes DNS. Re-deploying a PR preserves its database and credentials. Its generated login is stored in `~/.local/share/bayne/frontend/previews/pr-N/admin.env`. Do not post that file in PR comments. Closing a PR removes its DNS record, containers, private network, database volume, and credentials. Image tags remain available for rollback and can be removed separately when no longer needed.

A failed deployment can leave containers for inspection and retry. DNS is published only after local health checks pass. The deployment lock serializes host mutations. To roll back production, pass a retained prior frontend image to `manage.py main`; production database migrations are owned by the backend deployment.

## GitHub Actions runner

```bash
python3 deploy/register-runner.py --repo abulhuman/bayne-guest-house-frontend --start
```

The installer downloads the official Linux x64 runner, verifies the release SHA-256 digest, registers it using a short-lived token passed privately, and starts `bayne-frontend-runner.service` as a systemd user service. Its directory is `~/.local/share/bayne/frontend-runner` and its custom label is `bayne-frontend`.

Check `loginctl show-user "$USER" -p Linger`. If lingering is disabled, a system administrator must enable it with `sudo loginctl enable-linger "$USER"` for the user service to start at boot and survive logout. Container restart policies recover the deployed application whenever Docker starts. The runner is needed for new deployments, not to keep deployed containers serving requests.

Enable Actions on the temporary fork. The workflow needs no repository secrets. Cloudflare CLI authentication and runtime credentials stay on the host.

GitHub-hosted runners run the existing tests and build the image. A one-day Actions artifact transfers it to the on-prem runner. The on-prem runner checks that a PR is still open with the same head commit, or that the production SHA is still the main head, before deploying. It loads the image and invokes the installed deployment manager. PR jobs never check out or execute PR host scripts. Only a main deployment updates those scripts. Deploy and cleanup jobs share a per-PR concurrency group and do not cancel running migrations.

Same-repository contributors are trusted to run application containers. Fork PRs cannot deploy on this persistent host. Keep write access to the temporary fork limited to trusted maintainers and review workflow changes. Images, containers, and the shared edge host are not a sandbox for hostile code.

## Verification

```bash
curl --fail -H 'Host: manage.almishotel.com' http://127.0.0.1:8080/login
curl --fail https://manage.almishotel.com/login
curl --fail -H 'Host: pr-42.almishotel.com' http://127.0.0.1:8080/api/health
curl --fail https://pr-42.almishotel.com/api/health
systemctl --user status bayne-frontend-runner.service
```

Check production CORS with an `Origin: https://manage.almishotel.com` request to the production API. Test a preview login using its generated credentials and confirm the preview database volume and JWT key differ from production and other previews. Never dump environment files, Compose configuration, or full Docker inspection output into shared logs.

## Returning to the original repository

Once admin access is available on the original repository, move these deployment commits there, disable Actions on the temporary fork, stop and remove the fork's runner registration, and register the host runner against the original repository. Both repositories must not deploy production concurrently. The host configuration, DNS, tunnel, and existing production database can stay in place. The installer deliberately refuses to silently reuse a registration belonging to another repository.

Doppler remains optional. The only new secrets are generated per-PR credentials and the runner's local registration credentials. The existing tunnel token and production database/JWT secrets remain in the backend host deployment directory.
