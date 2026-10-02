# Retrospective

Accident narratives for this repo.

Routing: narrative stays here. A project-specific rule that will recur may become one line in `AGENTS.md`. Cross-project lessons go to nmem or a global rule. If it can be checked by a machine, add a hook or test instead of prose.


## 2026-10-02 — Require actual native and security results

The Node test lane conditionally omits four Bun-only server-entry checks, while the old security hook converted scanner errors into success. Root test commands now execute the native suite too, and pre-push requires installed scanners and propagates failures without printing secrets. The shutdown assertion no longer catches its own failure when the server stays reachable. Existing low coverage thresholds are unchanged and remain a contract gap, not95% proof.
