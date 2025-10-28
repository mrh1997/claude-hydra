# Rebase Branch

Rebase the current branch onto the base branch to incorporate the latest changes.

Please perform the following steps:

1. Check for uncommitted changes with `git status`
2. If there are uncommitted changes:
   - Create a temporary commit with `git add . && git commit -m "WIP: temporary commit for rebase"`
   - Note that we need to restore these changes later
3. Get the current branch name with `git branch --show-current`
4. Get the base branch from the environment variable `CLAUDE_HYDRA_BASE_BRANCH`
5. Rebase the current branch onto the base branch:
   - Run `git rebase $CLAUDE_HYDRA_BASE_BRANCH`
   - If conflicts occur:
     - Analyse all commits (diffs and commit messages) between the common base commit and the current branch / the common base commit and the base branch
     - Read the conflicted files
     - Analyze the conflicts and resolve them automatically
     - Use `git add <resolved-files>` to mark as resolved
     - Run `git rebase --continue`
     - Repeat until rebase completes
6. If there was a temporary commit created in step 2:
   - Run `git reset HEAD~1` to undo the temporary commit while keeping the changes in the working tree

Execute these steps without asking for confirmation. Handle all conflicts automatically.
