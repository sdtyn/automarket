# CAP Technical Notes

Running notes on non-obvious CAP behaviour, constraints, and decisions encountered
during development. Updated as new findings emerge — check here before debugging
something that looks like a CAP quirk.

---

## 1. Service Discovery in a Modular Folder Structure

**Context:** CAP automatically scans `srv/`, `app/`, and `db/` for `.cds` files.
If you move service definitions outside these folders (e.g. into `modules/<name>/api/`),
CAP will not find them and will silently start with "No service definitions found."

**Solution:** Use central index files as aggregators:

- `srv/index.cds` — imports every module's service definition
- `db/index.cds` — imports every module's entity definitions

Each new module must be registered in both files manually. This is the deliberate
trade-off for the modular folder structure: CAP's auto-discovery is sacrificed in
exchange for per-module isolation.

```cds
// srv/index.cds
using from '../modules/identity/api/identity-service';
using from '../modules/branch/api/branch-service';   // add each new module here
```

**Symptom if forgotten:** `cds watch` starts cleanly but prints:
```
No service definitions found in loaded models. Waiting for some to arrive...
```

---

## 2. `action` vs `function` in CDS Service Definitions

**Rule:** Use `action` for operations with side effects, `function` for read-only queries.

- CAP maps `action` → HTTP POST
- CAP maps `function` → HTTP GET

HTTP GET requests can be cached by browsers and intermediaries. Any operation that
writes data, issues a token, or changes state must be an `action` — using `function`
would allow the request to be served from cache, silently skipping the handler.

**Example:** `login` is an `action` because it resets `failedLoginCount`, updates
`lockedUntil`, and issues a JWT — all side effects.

---

## 3. Handler-to-Service Binding in a Modular Layout

**Context:** CAP's automatic `.cds` ↔ `.js` binding relies on co-location — the
definition and handler must share the same folder and base name:

```
srv/
  identity-service.cds   ← definition
  identity-service.js    ← handler (auto-detected)
```

In a modular layout the two files are in different folders, so auto-detection fails.
The binding must be declared explicitly in `package.json`:

```json
"cds": {
  "services": {
    "IdentityService": {
      "impl": "modules/identity/application/identity-service.js"
    }
  }
}
```

Each new module service needs its own entry here.

---

## 4. CAP Runtime Globals and ESLint

**Context:** CAP injects query keywords (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `UPSERT`)
into JavaScript's global scope at runtime. This means you can use them in any handler
file without `require`-ing anything — CAP puts them there automatically when the server starts.

**Problem:** ESLint performs static analysis and never sees the runtime. It flags these
as `'SELECT' is not defined`, causing CI to fail even though the code works correctly.

**Solution:** Declare them as known globals in `eslint.config.js`:

```js
globals: {
  ...globals.node,
  ...globals.jest,
  // CAP injects these as globals at runtime; ESLint must be told they exist.
  SELECT: 'readonly',
  INSERT: 'readonly',
  UPDATE: 'readonly',
  DELETE: 'readonly',
  UPSERT: 'readonly',
},
```

**Symptom if forgotten:** ESLint passes locally if you never run it, but CI fails with
`'SELECT' is not defined` errors on any file that uses CAP query syntax.

---

## 5. XSUAA Role Structure and CAP Mapping

**Three-layer model:**
```
Scope           → atomic permission unit  ($XSAPPNAME.Admin)
Role Template   → groups scopes; this is what CAP @requires maps to  (Admin)
Role Collection → assigned to BTP users; references role templates  (AutoMarket_Admin)
```

CAP `@requires: 'Admin'` matches the **role-template name**, not the scope or collection.
Users are assigned **role-collections** in BTP cockpit — never directly to role-templates.

**Production vs. local switch:** Use the `[production]` profile in `package.json` so
the same codebase uses mocked auth in dev and real XSUAA in production without any
code change — only the deployment environment differs:

```json
"requires": {
  "auth": { "kind": "mocked", "users": { ... } },
  "[production]": {
    "auth": { "kind": "xsuaa" }
  }
}
```

CAP activates the `[production]` block automatically when `NODE_ENV=production`.
