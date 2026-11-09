# Performance: what changed and why (phase 16)

This is the review document for phase 16. It's written while the work is done, one section per
task, so you can read it later without the code open. The plan it follows is
[performance-plan.md](performance-plan.md); source numbers like `[N1]` and `[S3]` point to the list
at the end of that plan.

**How to read it.** Start with "Waiting for George" and "Progress". Then each task's section has
the same seven parts:

1. **The problem**, in plain words: what a person using the app saw or waited for.
2. **What changed**: the behaviour first, then the files.
3. **Why this way**: the choice, the options turned down, and the source for it.
4. **Numbers**: before and after, with the command that produced each one.
5. **How to check it yourself**: steps you can do in the app or the terminal in a few minutes.
6. **Risks and how to undo it**: what could go wrong and the PR to revert.
7. **Left open**: anything not done, not measured or waiting on a decision.

A number in this document is either measured (with its command next to it) or marked
**not measured**, with the reason. Nothing here is an estimate presented as a result.

## Waiting for George

Things only you can do or decide. Nothing in this list blocks the tasks that are merged.

| # | What | Why it matters | Where it's explained |
| --- | --- | --- | --- |
| 1 | Move the Supabase project to asymmetric JWT signing keys (dashboard → JWT Signing Keys) | Removes one or two calls to Supabase Auth from every signed-in request, with no code change | Plan, "Decisions for George"; PF4 below |
| 2 | Agree or change the budgets | They decide what "fast enough" means for PF13 | PF1 below |

## Progress

| Task | What | Status | PR |
| --- | --- | --- | --- |
| PF1 | Baseline and budgets | not started | |
| PF2 | No endless loading | not started | |
| PF3 | Skeletons and a boundary per section | not started | |
| PF4 | Fewer round trips in the app | not started | |
| PF5 | Session gate and account on the server | not started | |
| PF6 | First data on the server for Home | not started | |
| PF7 | The same for Expenses, To-dos and Reminders | not started | |
| PF8 | Prefetching, waterfalls and stable data | not started | |
| PF9 | Smaller bundles | not started | |
| PF10 | SQL: indexes and RLS for the slow queries | not started | |
| PF11 | Smooth interaction | not started | |
| PF12 | Lean runtime on the VPS | not started | |
| PF13 | Measure and close | not started | |

## The short version

*(Filled in as tasks merge: one line per improvement, with its headline number.)*

## Baseline and budgets

*(PF1 writes this: where the app stood before any change, how each number was measured, and the
budgets.)*

## The tasks

*(One section per task, added by the task's own PR, in the seven-part shape above.)*
