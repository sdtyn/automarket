# Development Notes

Common development workflow issues, their root causes, and solutions.
Updated as new issues are encountered during development.

---

## 1. Prettier Format Check Failing in CI

**Symptom:**
```
[warn] some-file.js
[warn] Code style issues found in N files. Run Prettier with --write to fix.
Error: Process completed with exit code 1.
```

**Root cause:** Code written manually (typed by hand) does not always match
Prettier's exact formatting expectations — indentation, quote style, trailing
commas, line length, semicolons. Even a single extra space triggers a failure.
CI runs Prettier in `--check` mode, which fails on any deviation without fixing it.

**Solution:** Always run Prettier with `--write` before committing:
```bash
npm run format
```
Then stage the reformatted files and commit. The CI format check will pass cleanly.

**Prevention:** Make `npm run format` the first step before every `git add`.
Never commit without running it first.

---

## 2. ESLint `no-undef` Errors for CAP Query Globals

**Symptom:**
```
error  'SELECT' is not defined  no-undef
error  'UPDATE' is not defined  no-undef
```

**Root cause:** CAP injects `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`
into the JavaScript global scope at runtime. ESLint performs static analysis
and never sees the runtime — it flags them as undefined variables.

**Solution:** Declare them as known globals in `eslint.config.js`. See `cap-notes.md §4`
for the exact configuration.

---

## 3. Local PostgreSQL Setup & Schema Migration (EPIC23-T1)

The project uses SQLite in-memory (`:memory:`) for local development and CI — zero setup, but data
never persists and there is no schema-evolution history. Production (`NODE_ENV=production` / the
`[production]` cds profile, `package.json`) is configured for PostgreSQL via `@cap-js/postgres`
instead (`"db": {"kind": "postgres"}` under `cds.requires.[production]`).

**Running against a real local PostgreSQL** (to test the production DB config before deploying):

```bash
# Any local PostgreSQL 14+ works. Example via Docker:
docker run --name automarket-pg -e POSTGRES_PASSWORD=devpw -e POSTGRES_DB=automarket -p 5432:5432 -d postgres:16

# Point cds at it (local override, never commit real credentials — see EPIC23-T6
# for the full environment-variable story):
export NODE_ENV=production
export CDS_REQUIRES_DB_CREDENTIALS_HOST=localhost
export CDS_REQUIRES_DB_CREDENTIALS_PORT=5432
export CDS_REQUIRES_DB_CREDENTIALS_DATABASE=automarket
export CDS_REQUIRES_DB_CREDENTIALS_USER=postgres
export CDS_REQUIRES_DB_CREDENTIALS_PASSWORD=devpw
```

**Schema deployment — no hand-written migration files.** `@cap-js/postgres` brings its own schema
evolution mechanism (the same one used for SAP HANA), tracked in a `cds_model` table it creates
itself — not a `db/migrations/*.sql` folder maintained by hand. Deviates from the original backlog
wording ("create `db/migrations/` with an initial schema migration script"), confirmed with the
user before implementing:

```bash
# One-time, first deployment only — creates cds_model (the schema-evolution
# baseline) and the full initial schema from the current CDS model:
npx cds deploy --model-only
npx cds deploy

# Every subsequent deployment (after a CDS model change) — compares the
# current model against cds_model and applies only the delta (ALTER TABLE
# etc.), not a drop-and-recreate:
npx cds deploy
```

To preview the SQL a deploy would run without touching any database (useful for reviewing a schema
change before applying it, or for generating a one-off reference snapshot):

```bash
npx cds deploy --to postgres --dry
```

**Not yet verified against a real running PostgreSQL instance** — this sandbox has no `docker`/local
`postgres` available, so only the `[production]` cds config resolution was confirmed
(`npx cds env get requires.db --profile production` correctly resolves `kind: postgres`,
`schema_evolution: auto`, `impl: @cap-js/postgres`). The actual `cds deploy --model-only` / `cds
deploy` flow against a live PostgreSQL should be run at least once before this is considered
production-ready — flagged here rather than silently assumed to work.
