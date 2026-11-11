# Agent notes

## Deploys

- Deployment: every push to `main` is built and published automatically to the self-hosted web
  server. Response headers, rewrites and URL rules live in `site.json`.
- Every merge to `main` is a production deploy. Other branches are not deployed; CI (typecheck,
  test, build) runs on every PR. Keep related fixes in one PR.
- To QA a built client with the capture and test hooks (`?shot=`, `?qa=1`, `?room=`), build it
  with `VITE_DEV_TOOLS=true` and serve it locally (`npm run preview`). Production builds leave
  `VITE_DEV_TOOLS` unset, so the hooks are dead there.
