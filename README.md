# Glassa Games

React/Vite storefront using the current Glassa Games design and Firebase. The optional Node/Express API remains available separately.

## Repository layout

- `artifacts/glassa-store` — frontend (all current Replit design/features).
- `artifacts/api-server` — Node/Express API for server-side operations.
- `lib` — shared API/database packages.
- `.github/workflows/deploy-pages.yml` — automatic GitHub Pages deployment.

## GitHub Pages deployment

1. Push the repository to GitHub.
2. GitHub: **Settings → Pages → Source → GitHub Actions**.
3. Push to `main` or `master`.
4. The workflow builds and deploys the frontend automatically.

The workflow sets the Vite base path to the repository name and copies `index.html` to `404.html` so SPA routes work on GitHub Pages.

## Environment variables

Frontend Firebase configuration belongs in Vite `VITE_*` variables. Public Firebase web config is safe to expose in the browser; never commit private service-account keys.

A template is provided at `artifacts/glassa-store/.env.example`.

## Local

```bash
pnpm install
pnpm dev
```

## API server

GitHub Pages does not run Node/Express. If the API is required, deploy `artifacts/api-server` to a Node-compatible host and set the frontend API URL accordingly.

## Firebase

Deploy/review `artifacts/glassa-store/firestore.rules` separately in Firebase. Client-side code is not a security boundary.
