# Rebase Branch

Rebase the current branch onto the base branch to incorporate the latest changes.

This will:
1. If there are uncommitted changes, create a temporary commit
2. Rebase the current branch onto the base branch
3. If conflicts occur, resolve them automatically without user interaction
4. After rebase completes, restore any uncommitted changes back to the working tree (by undoing the temporary commit)

All uncommitted changes are preserved throughout the rebase process. Conflicts are resolved automatically without user interaction.
