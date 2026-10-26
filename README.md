# Almis Guest House frontend

The Next.js frontend for Almis Guest House calls the hotel API through `NEXT_PUBLIC_API_BASE`.

## Local development

Set `NEXT_PUBLIC_API_BASE=http://localhost:3001` in `.env.local`, install dependencies with `npm ci`, then run `npm run dev`. Open http://localhost:3000.

## On-prem deployment

Production runs at https://manage.almishotel.com and uses https://api.almishotel.com. PR previews use `https://pr-N.almishotel.com`, each with an isolated API and database. Docker containers join the existing backend's Traefik network behind Cloudflare Tunnel.

The temporary deployment fork is [abulhuman/bayne-guest-house-frontend](https://github.com/abulhuman/bayne-guest-house-frontend). See [deploy/README.md](deploy/README.md) for host setup, CI, credentials, verification, and the move back to the original repository.
<!-- FE-4 live check, scratch PR. Do not merge. -->
