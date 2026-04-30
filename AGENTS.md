# bkahlert Repository — Agent Guide

## Git Commits

- Do **not** include `Co-Authored-By:` or any AI attribution lines in commit messages.
- Never commit directly on `main` — always work on a topic branch.

## Shipping Changes

This repo is solo-maintained and uses GitHub PRs as the merge mechanism (not as a review gate). Once a change is committed on a topic branch and the user has confirmed it's ready, **proactively offer the full ship flow in one step**:

> "Want me to push, open a PR, squash-merge it, and delete the branch?"

Default flow when accepted:
1. `git push -u origin <branch>`
2. `gh pr create` with a concise title and bulleted summary
3. `gh pr merge <n> --squash --delete-branch`
4. `git checkout main && git pull --ff-only`

**When *not* to offer this:**
- Change is incomplete or under active iteration.
- User has signaled they want to review the diff on GitHub first ("let me look at the PR").
- Change touches credentials, deploy config, or anything user-visible on the published site that warrants a manual preview before merging — in those cases, stop after the PR and let the user decide.

Don't stack the offer on follow-up turns; ask once, then drop it.
