import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendStateUpdate, sendReadyStateWithGitStatus } from '$lib/server/websocket-manager';

export const POST: RequestHandler = async ({ params, request }) => {
	const { branchname } = params;
	const { state } = await request.json();

	// Validate state
	if (state !== 'ready' && state !== 'running') {
		return json({ error: 'Invalid state' }, { status: 400 });
	}

	// Send state update to the WebSocket connection for this branch
	let sent: boolean;
	if (state === 'ready') {
		// Use shared function that updates both state and git status
		sent = sendReadyStateWithGitStatus(branchname);
	} else {
		// For 'running' state, just send state update
		sent = sendStateUpdate(branchname, state);
	}

	if (!sent) {
		return json({ error: 'No active session for this branch' }, { status: 404 });
	}

	return json({ success: true });
};
