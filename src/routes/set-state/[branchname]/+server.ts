import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendStateUpdate, sendGitBranchStatus } from '$lib/server/websocket-manager';
import { getSessionManager } from '$lib/server/session-manager-instance';

export const POST: RequestHandler = async ({ params, request }) => {
	const { branchname } = params;
	const { state } = await request.json();

	// Validate state
	if (state !== 'ready' && state !== 'running') {
		return json({ error: 'Invalid state' }, { status: 400 });
	}

	// Send state update to the WebSocket connection for this branch
	const sent = sendStateUpdate(branchname, state);

	if (!sent) {
		return json({ error: 'No active session for this branch' }, { status: 404 });
	}

	// If state is "ready", also send git branch status
	if (state === 'ready') {
		const sessionManager = getSessionManager();
		const sessionId = sessionManager.getSessionIdByBranch(branchname);
		if (sessionId) {
			try {
				const gitStatus = sessionManager.getGitStatus(sessionId);
				sendGitBranchStatus(branchname, gitStatus);
			} catch (error) {
				console.error(`Failed to get git status for branch ${branchname}:`, error);
			}
		}
	}

	return json({ success: true });
};
