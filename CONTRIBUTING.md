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
