# Agent notes

## Vercel deploys (2026-09-28)

- Previews are off by default. `vercel.json` sets `git.deploymentEnabled` to
  `{ "main": true, "**": false }` (`**`, because `*` doesn't match branch names with a slash),
  so only `main` deploys on its own. Pushing any other branch creates no Vercel deployment and
  no Vercel check on the PR. CI (typecheck, test, build) still runs on every PR.
- The Hobby team gets 100 deployments per 24 hours (a rolling 86,400 s window, not a calendar
  day), shared by every project on it (this one, personal-portfolio, NavOSS and more). Git, CLI
  and API deployments all count, and so do builds canceled by an Ignored Build Step. Once it
  runs out, merges to `main` stop reaching strafe.yassin.app until slots free up.
- Batch commits: push a branch when it's ready for review, not after every commit, and keep
  related fixes in one PR. Every merge to `main` is a production deploy.
- A branch cut before this change still has the old `vercel.json` and builds a preview on every
  push. Merge `origin/main` into it before pushing again.
- When QA really needs a real Vercel preview (for example to check production headers or the
  real Vercel build), deploy once from a clean worktree and reuse the URL:

  ```sh
  vercel deploy --dry --project webstrafe --scope yassins-projects-11732a5e  # lists the upload, creates nothing
  vercel deploy --project webstrafe --scope yassins-projects-11732a5e        # prints the preview URL
  ```

  It builds with the Preview environment variables and `VERCEL_ENV=preview`, so the dev tools
  are on like on a branch preview. The CLI uploads the folder as it is, gitignored files
  included (`dist/`, `.artifacts/`, `public/config/webstrafe.config.json`), and a clean checkout
  is already about 90 MB.
- Previews sit behind Vercel Authentication. The automation bypass secret is in
  `~/.config/webstrafe/vercel-bypass.txt` (usage in `~/.config/webstrafe/README.txt`): send it
  as the `x-vercel-protection-bypass` header, or pass
  `BYPASS_FILE=~/.config/webstrafe/vercel-bypass.txt` to the `tools/qa` scripts. Never commit it
  or paste it into code, logs, PRs or chat.
