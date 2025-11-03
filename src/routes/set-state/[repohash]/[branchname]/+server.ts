import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendStateUpdate, sendReadyStateWithGitStatus, sendCloseTabRequest, sendDiscardAndCloseRequest, sendKeepBranchAndCloseRequest, sendWaituserRequest } from '$lib/server/websocket-manager';
import { getRepositoryRegistry } from '$lib/server/session-manager-instance';

export const POST: RequestHandler = async ({ params, request }) => {
	const { repohash, branchname } = params;
	const body = await request.json();
	const { state, text, commandline, mode } = body;

	// Validate state
	if (state !== 'ready' && state !== 'running' && state !== 'close' && state !== 'waituser') {
		return json({ error: 'Invalid state' }, { status: 400 });
	}

	// Validate waituser parameters
	if (state === 'waituser' && !commandline) {
		return json({ error: 'waituser state requires commandline parameter' }, { status: 400 });
	}

	// Send state update to the WebSocket connection for this repository+branch combination
	let sent: boolean;
	if (state === 'ready') {
		// Use shared function that updates both state and git status
		sent = sendReadyStateWithGitStatus(repohash, branchname);
	} else if (state === 'close') {
		// Handle close with optional mode parameter
		if (mode === 'discard') {
			// Discard everything and close immediately
			sent = sendDiscardAndCloseRequest(repohash, branchname);
		} else if (mode === 'keep-branch') {
			// Keep branch and close
			sent = sendKeepBranchAndCloseRequest(repohash, branchname);
		} else {
			// For 'close' state without mode, check git status and only close if clean
			const registry = getRepositoryRegistry();
			const sessionId = registry.getSessionIdByRepoHashAndBranch(repohash, branchname);

			if (!sessionId) {
				return json({ error: 'No active session for this repository and branch' }, { status: 404 });
			}

			const sessionManager = registry.getRepositoryBySessionId(sessionId);
			if (!sessionManager) {
				return json({ error: 'No session manager found' }, { status: 404 });
			}

			try {
				const gitStatus = sessionManager.getGitStatus(sessionId);

				// Only send close request if there are no uncommitted changes and no unmerged commits
				if (!gitStatus.hasUncommittedChanges && !gitStatus.hasUnmergedCommits) {
					// Check if base branch has changed (merge likely occurred)
					// This will update the stored base branch commit ID
					const baseBranchChanged = sessionManager.checkAndUpdateBaseBranch(sessionId);

					if (baseBranchChanged) {
						// Base branch changed - broadcast git status to all remaining tabs
						// so they show as outdated before we close this tab
						console.log('Base branch changed after merge - broadcasting git status to all tabs');
						const { broadcastGitStatusToAll } = await import('$lib/server/websocket-manager');
						broadcastGitStatusToAll(
							repohash,
							sessionManager.getAllSessions(),
							(sid) => sessionManager.getGitStatus(sid)
						);
					}

					sent = sendCloseTabRequest(repohash, branchname);
				} else {
					// Don't close if there are uncommitted changes or unmerged commits
					return json({ success: false, message: 'Tab not closed due to uncommitted changes or unmerged commits' });
				}
			} catch (error: any) {
				return json({ error: `Failed to get git status: ${error.message}` }, { status: 500 });
			}
		}
	} else if (state === 'waituser') {
		// For 'waituser' state, send waituser request with text and commandline
		sent = sendWaituserRequest(repohash, branchname, text || commandline, commandline);
	} else {
		// For 'running' state, just send state update
		sent = sendStateUpdate(repohash, branchname, state);
	}

	if (!sent) {
		return json({ error: 'No active session for this repository and branch' }, { status: 404 });
	}

	return json({ success: true });
};
