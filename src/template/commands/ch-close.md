Close current Claude-Hydra Tab. Optional parameters: discard|keep-branch

Options:
- No argument: Shows dialog if uncommitted changes or unmerged commits exist
- `discard`: Discards all uncommitted changes and unmerged commits, then closes tab
- `keep-branch`: Creates WIP commit if uncommitted changes exist, deletes worktree but keeps branch

Examples:
- `/ch-close` - Shows dialog if there are changes
- `/ch-close discard` - Immediately discard everything and close
- `/ch-close keep-branch` - Keep branch with WIP commit, delete worktree
