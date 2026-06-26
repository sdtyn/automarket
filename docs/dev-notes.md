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
