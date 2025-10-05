import type { Handle } from '@sveltejs/kit';
import { WebSocketServer } from 'ws';
import { PtyManager } from '$lib/server/pty-manager';
import { SessionManager } from '$lib/server/session-manager';
import { registerConnection, unregisterConnection } from '$lib/server/websocket-manager';

let wss: WebSocketServer | null = null;
let sessionManager: SessionManager;
let ptyManager: PtyManager;

// Initialize SessionManager - will throw if not in a git repository
try {
	sessionManager = new SessionManager();
	ptyManager = new PtyManager(sessionManager);
} catch (error) {
	console.error('Failed to initialize server:', error);
	process.exit(1);
}

// Initialize WebSocket server
function initWebSocketServer() {
	if (wss) return;

	wss = new WebSocketServer({ port: 3001 });

	wss.on('connection', (ws) => {
		console.log('WebSocket client connected');
		let sessionId: string | null = null;
		let branchName: string | null = null;

		ws.on('message', (message) => {
			try {
				const data = JSON.parse(message.toString());

				switch (data.type) {
					case 'create':
						// Create a new terminal session
						try {
							if (!data.branchName) {
								ws.send(JSON.stringify({ type: 'error', error: 'Branch name is required' }));
								break;
							}

							branchName = data.branchName;

							// Determine base URL for hooks to call back
							const baseUrl = process.env.NODE_ENV === 'production'
								? 'http://localhost:4173'
								: 'http://localhost:5173';

							sessionId = ptyManager.createSession(
								data.branchName,
								(sid, output) => {
									// Send terminal output to client
									if (ws.readyState === ws.OPEN) {
										ws.send(JSON.stringify({ type: 'data', data: output }));
									}
								},
								(sid) => {
									// Handle terminal exit
									if (ws.readyState === ws.OPEN) {
										ws.send(JSON.stringify({ type: 'exit' }));
									}
								},
								baseUrl
							);

							// Register this connection with the branch name
							registerConnection(branchName, ws);

							ws.send(JSON.stringify({ type: 'created', sessionId, branchName }));
						} catch (error: any) {
							const errorMessage = error.message || String(error);
							console.error('Failed to create session:', errorMessage);
							ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
						}
						break;

					case 'data':
						// Send input to terminal
						if (sessionId) {
							ptyManager.write(sessionId, data.data);
						}
						break;

					case 'resize':
						// Resize terminal
						if (sessionId) {
							ptyManager.resize(sessionId, data.cols, data.rows);
						}
						break;

					case 'getGitStatus':
						// Get git status for the session
						// Accept sessionId from message payload or use connection's sessionId
						const statusSessionId = data.sessionId || sessionId;
						if (statusSessionId) {
							try {
								const status = sessionManager.getGitStatus(statusSessionId);
								ws.send(JSON.stringify({ type: 'gitStatus', status }));
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to get git status:', errorMessage);
								ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
							}
						}
						break;

					case 'merge':
						// Merge session branch to base branch
						// Accept sessionId from message payload or use connection's sessionId
						const mergeSessionId = data.sessionId || sessionId;
						if (mergeSessionId) {
							// First, kill the PTY process to release file handles
							// Skip worktree cleanup since merge will handle it
							ptyManager.destroy(mergeSessionId, true);

							// Wait a bit for process to fully exit and file handles to be released
							setTimeout(() => {
								const result = sessionManager.merge(mergeSessionId, data.commitMessage);

								// If merge failed, we need to cleanup the merging flag
								// (though the session is already destroyed, so this is just cleanup)

								ws.send(JSON.stringify({ type: 'mergeResult', result }));
								if (result.success && mergeSessionId === sessionId) {
									// Clear sessionId only if we're merging this connection's session
									sessionId = null;
								}
							}, 500);
						}
						break;

					case 'destroy':
						// Destroy terminal session
						if (sessionId) {
							ptyManager.destroy(sessionId);
							sessionId = null;
						}
						break;
				}
			} catch (error) {
				console.error('WebSocket message error:', error);
			}
		});

		ws.on('close', () => {
			console.log('WebSocket client disconnected');
			if (sessionId) {
				ptyManager.destroy(sessionId);
			}
			if (branchName) {
				unregisterConnection(branchName);
			}
		});

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
		});
	});

	console.log('WebSocket server started on port 3001');
}

// Start WebSocket server
initWebSocketServer();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
