# Contributing to AutoMarket

## Branch Strategy

- `main` is the single source of truth; protected against force-push and deletion.
- While the project has a single developer, work is committed directly to `main`.
- Mandatory PR review (>=1 approval) is deferred until a second collaborator joins the
  project — at that point, enable "Require a pull request before merging" on `main`.
- Branch naming convention (for future feature branches, once collaborators exist):
  `epic<NN>-t<N>-short-description`, lowercase, hyphen-separated.
  Example: `epic02-t3-mfa-enforcement`.

## Commit Message Convention

Every commit message is prefixed with the Epic/Ticket it belongs to:

[EPIC<NN>-T<N>] <short description>

Example: `[EPIC01-T1] Add CONTRIBUTING.md with branch and commit policy`

## Deferred: BTP-Specific Work (EPIC01-T6)

The following Sprint 0 stories require real SAP BTP services and are **not implemented**
in this phase — only documented, per the project's "local-only development" decision:

- US-1.7 — XSUAA service binding for DEV/TEST
- US-1.8 — Application Router in front of CAP
- US-1.9 — HTML5 Application Repository
- US-1.10 — Network isolation (no public path to CAP/HANA)
- US-1.12 — Application Logging Service / SAP Cloud ALM
- US-1.13 — BTP subaccount provisioning (DEV/TEST/UAT/PROD)

**Why:** no BTP trial/Cloud Foundry account was available when this project started.
Local development already follows the documented fallback path (Implementation
Architecture Document §20: `Email → Password → JWT → CAP` instead of
`SAP IAS → XSUAA → CAP`), so this is not a workaround — it's the path the
architecture document itself defines for local dev.

**Revisit when:** a BTP trial/CF account becomes available, and in any case before
the first real (non-local) deployment — these six items become a hard blocker at
that point, not before.
