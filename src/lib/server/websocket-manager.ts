import type { WebSocket } from 'ws';

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
