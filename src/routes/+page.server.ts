import { sessionManager } from '../hooks.server';

export async function load() {
	// Discover existing claude-hydra worktrees from previous sessions
	const existingWorktrees = sessionManager.discoverExistingWorktrees();

	return {
		existingWorktrees
	};
}
