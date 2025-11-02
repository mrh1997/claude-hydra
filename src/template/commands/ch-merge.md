# Merge Branch

Merge the current branch into the base branch with automatic conflict resolution.

Please perform the following steps:

1. Check for uncommitted changes with `git status`
2. If there are uncommitted changes:
   - Do `git diff` to get list of changes
   - Analyze the changes
   - Create a meaningful commit using the /ch-commit command
3. Get the current branch name with `git branch --show-current`
4. Get the base branch from the environment variable `CLAUDE_HYDRA_BASE_BRANCH`
5. Get the main worktree with `git worktree list` (see first entry)
6. Rebase the current branch onto the base branch:
   - Run `git rebase $CLAUDE_HYDRA_BASE_BRANCH`
   - If conflicts occur:
     - Analyse all commits (diffs and commit messages) between the common base commit and the current branch / the common base commit and the base branch
     - Read the conflicted files
     - Analyze the conflicts and resolve them automatically
     - Use `git add <resolved-files>` to mark as resolved
     - Run `git rebase --continue`
     - Repeat until rebase completes
7. Fastforward the base Branch to the current branch dependend on which type of branch the base branch is:
     - in case of a local branch with a working tree:
       In the worktree of the base Branch Fast-forward merge the current/rebased branch: `git merge --ff-only <current-branch>`
     - in case of a local branch without a working tree:
       fast forward the current/rebased branch directlry (from current working tree)
     - in case of a remote branch:
       push the current/rebased branch directly to the remote repository under the name of the base branch
    
       

Execute these steps without asking for confirmation. Handle all conflicts automatically.
