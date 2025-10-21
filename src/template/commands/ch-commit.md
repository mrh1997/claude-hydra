# Commit Changes

Create a commit with all uncommitted changes in the current worktree.

Please perform the following steps:

1. Run `git diff` to analyze all uncommitted changes (both staged and unstaged)
2. Generate a meaningful commit message based on the changes.
   If the user passed an argument interpret it as prompt that finetunes your commit message
   (i.e. "insert extensive bugreport" or "focus on UI changes")
3. Stage all changes with `git add .`
4. Create a commit with the generated message, including the standard footer:
   ```

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

Execute these steps now without asking for confirmation.
