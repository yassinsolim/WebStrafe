# Supabase migrations

Run these in order on the project from `public/config/webstrafe.config.json`,
after `supabase/schema.sql`. Each file is safe to run again.

| file | what it adds |
|---|---|
| `20260927000001_surf_runs_and_kills.sql` | ranked surf runs (per map and per stage), ghosts, kill sessions, the `webstrafe_*` functions the client calls, rls and rate limits |
| `20260927000002_map_rules.sql` | per map rules: stages and minimum times. generated, rerun `npx tsx tools/surf/mapRules.ts` when a map's zones change and run the new file |

Dashboard: SQL Editor, New query, paste the file, Run. Or with the CLI linked
to the project: `supabase db push`.

The game works without them (ranked boards stay off and the old leaderboard is
used), so they can go in any time.

Test locally (docker, nothing touches the real project):

```sh
./tools/surf/test-migrations.sh        # sql tests
./tools/surf/test-migrations.sh --e2e  # plus postgrest and the real client
```
