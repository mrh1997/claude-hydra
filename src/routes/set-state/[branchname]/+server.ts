import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendStateUpdate, sendReadyStateWithGitStatus, sendCloseTabRequest } from '$lib/server/websocket-manager';
import { getRepositoryRegistry } from '$lib/server/session-manager-instance';

export const POST: RequestHandler = async ({ params, request }) => {
	const { branchname } = params;
	const { state } = await request.json();

	// Validate state
	if (state !== 'ready' && state !== 'running' && state !== 'close') {
		return json({ error: 'Invalid state' }, { status: 400 });
	}

	// Send state update to the WebSocket connection for this branch
	let sent: boolean;
	if (state === 'ready') {
		// Use shared function that updates both state and git status
		sent = sendReadyStateWithGitStatus(branchname);
	} else if (state === 'close') {
		// For 'close' state, check git status and only close if clean
		const registry = getRepositoryRegistry();
		const sessionId = registry.getSessionIdByBranch(branchname);

		if (!sessionId) {
			return json({ error: 'No active session for this branch' }, { status: 404 });
		}

		const sessionManager = registry.getRepositoryBySessionId(sessionId);
		if (!sessionManager) {
			return json({ error: 'No session manager found' }, { status: 404 });
		}

		try {
			const gitStatus = sessionManager.getGitStatus(sessionId);

			// Only send close request if there are no uncommitted changes and no unmerged commits
			if (!gitStatus.hasUncommittedChanges && !gitStatus.hasUnmergedCommits) {
				sent = sendCloseTabRequest(branchname);
			} else {
				// Don't close if there are uncommitted changes or unmerged commits
				return json({ success: false, message: 'Tab not closed due to uncommitted changes or unmerged commits' });
			}
		} catch (error: any) {
			return json({ error: `Failed to get git status: ${error.message}` }, { status: 500 });
		}
	} else {
		// For 'running' state, just send state update
		sent = sendStateUpdate(branchname, state);
	}

	if (!sent) {
		return json({ error: 'No active session for this branch' }, { status: 404 });
	}

	return json({ success: true });
};
