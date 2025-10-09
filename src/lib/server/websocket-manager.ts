import type { WebSocket } from 'ws';
import type { GitStatus, SessionInfo } from './session-manager';

// Map branchname to WebSocket connection
const branchConnections = new Map<string, WebSocket>();

export function registerConnection(branchName: string, ws: WebSocket) {
	branchConnections.set(branchName, ws);
}

export function unregisterConnection(branchName: string) {
	branchConnections.delete(branchName);
}

export function sendStateUpdate(branchName: string, state: 'ready' | 'running'): boolean {
	const ws = branchConnections.get(branchName);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify({ type: 'state', state }));
		return true;
	}
	return false;
}

export function sendGitBranchStatus(branchName: string, gitStatus: GitStatus): boolean {
	const ws = branchConnections.get(branchName);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify({ type: 'gitBranchStatus', gitStatus }));
		return true;
	}
	return false;
}

export function broadcastGitStatusToAll(sessions: Map<string, SessionInfo>, getGitStatus: (sessionId: string) => GitStatus): void {
	for (const [sessionId, session] of sessions) {
		try {
			const gitStatus = getGitStatus(sessionId);
			sendGitBranchStatus(session.branchName, gitStatus);
		} catch (error) {
			console.error(`Failed to broadcast git status for session ${sessionId}:`, error);
		}
	}
}
