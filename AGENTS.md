# Repository development and sync rules

This repository is maintained against an upstream repository. Changes should be easy to review, cherry-pick, rebase, and sync.

## Scope and change size

- Keep each change narrowly scoped to the requested behavior.
- Preserve existing behavior for unrelated sources, APIs, models, workers, configuration, and deployment targets.
- Do not combine cleanup, formatting, renaming, or unrelated refactoring with a functional fix.
- Before editing, inspect the current diff and preserve pre-existing user changes.

## Conflict minimization

- Prefer a new focused file under the nearest existing module directory for new behavior, adapters, compatibility layers, and source-specific state.
- Touch shared or upstream-heavy files only for the smallest required integration point.
- Keep integration points thin: import a helper and delegate; do not place feature logic in routing, worker, registry, or central aggregation files.
- Do not move existing blocks or reformat surrounding code merely to make an edit.
- Avoid changing public models or generic protocols when a source-specific adapter can express the behavior.
- Do not add behavior to a central file when an existing extension point or a new local module can contain it.
- Keep automatic matching/search results separate from UI/manual-only virtual entries or compatibility entries.
- If a change must touch a high-conflict file, keep that change isolated and document why.

## Compatibility and failure behavior

- Preserve existing public response shapes and fallback behavior unless the request explicitly changes them.
- Keep source-specific formats and prefixes source-specific; do not make a private compatibility address a generic player protocol.
- Distinguish a valid empty result from a failed request. Partial results must not be cached as complete results.
- Do not introduce strict/optional modes or extra policy branches unless they are required by the request.
- Prefer recoverable, additive behavior over destructive replacement of existing entries.

## Tests and review

- Add focused regression tests in a new or source-specific test file when possible; avoid editing broad shared tests unnecessarily.
- Run the smallest relevant tests first, then the affected integration tests.
- Run `git diff --check` before handoff.
- Review the final diff for accidental changes, duplicate logic, unnecessary imports, and edits to high-conflict files.
- Report any known unrelated failing test separately instead of altering unrelated code to make it pass.

## Sync workflow

1. Inspect upstream changes before rebasing or syncing.
2. Reapply the smallest integration points and keep new feature logic in dedicated files.
3. Resolve conflicts by preserving upstream behavior first, then reattaching the local adapter.
4. Run focused tests and the affected worker/API tests after conflict resolution.
5. Do not use a sync conflict as a reason to broaden the change or rewrite surrounding code.

