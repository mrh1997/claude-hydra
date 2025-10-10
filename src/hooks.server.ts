import type { Handle } from '@sveltejs/kit';
import { WebSocketServer } from 'ws';
import { PtyManager } from '$lib/server/pty-manager';
import { SessionManager } from '$lib/server/session-manager';
import { registerConnection, unregisterConnection, sendGitBranchStatus, broadcastGitStatusToAll } from '$lib/server/websocket-manager';
import { setSessionManager } from '$lib/server/session-manager-instance';

// Read ports from environment variables set by claude-hydra-server.js
const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);
const MGMT_PORT = parseInt(process.env.MGMT_PORT || '3002', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000', 10);

// Use globalThis to persist WebSocket servers across HMR reloads
declare global {
	var __wss: WebSocketServer | null;
	var __mgmtWss: WebSocketServer | null;
	var __ptyManager: PtyManager | null;
	var __hasManagementClient: boolean;
	var __shutdownTimeout: NodeJS.Timeout | null;
}

let wss: WebSocketServer | null = globalThis.__wss || null;
let mgmtWss: WebSocketServer | null = globalThis.__mgmtWss || null;
let sessionManager: SessionManager;
let ptyManager: PtyManager;
let hasManagementClient = globalThis.__hasManagementClient || false;
let shutdownTimeout: NodeJS.Timeout | null = globalThis.__shutdownTimeout || null;

// Check if we're in development mode (set by claude-hydra-server.js)
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

// Initialize SessionManager - will throw if not in a git repository
try {
	sessionManager = new SessionManager();
	setSessionManager(sessionManager); // Register the singleton instance
	ptyManager = new PtyManager(sessionManager);
} catch (error) {
	console.error('Failed to initialize server:', error);
	process.exit(1);
}

// Export sessionManager for use in other modules (e.g., +page.server.ts)
export { sessionManager };

// Initialize WebSocket server
function initWebSocketServer() {
	if (wss) {
		console.log('WebSocket server already running on port ' + WS_PORT);
		return;
	}

	wss = new WebSocketServer({ port: WS_PORT });
	globalThis.__wss = wss;

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
						const adoptExisting = data.adoptExisting || false;

						// Determine base URL for hooks to call back using actual HTTP port
						const baseUrl = `http://localhost:${HTTP_PORT}`;

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
							baseUrl,
							adoptExisting
						);

						// Register this connection with the branch name
						registerConnection(branchName, ws);

						// When adopting existing worktree, send initial git status immediately
						// (connection must be registered first for the message to be sent)
						if (adoptExisting) {
							try {
								const gitStatus = sessionManager.getGitStatus(sessionId);
								sendGitBranchStatus(branchName, gitStatus);
							} catch (error) {
								console.error(`Failed to send initial git status for ${branchName}:`, error);
							}
						}

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
							const result = sessionManager.merge(mergeSessionId, data.commitMessage);

							ws.send(JSON.stringify({ type: 'mergeResult', result }));

							// After successful merge, broadcast updated git status to all tabs
							if (result.success) {
								broadcastGitStatusToAll(
									sessionManager.getAllSessions(),
									(sid) => sessionManager.getGitStatus(sid)
								);
							}
						}
						break;

					case 'commit':
						// Commit changes in session
						const commitSessionId = data.sessionId || sessionId;
						if (commitSessionId) {
							const commitResult = sessionManager.commit(commitSessionId, data.commitMessage);
							ws.send(JSON.stringify({ type: 'commitResult', result: commitResult }));

							// Send updated git status after commit
							if (commitResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(commitSessionId);
									const targetBranch = ptyManager.getBranchName(commitSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus);
									}
								} catch (error) {
									console.error('Failed to send git status after commit:', error);
								}
							}
						}
						break;

					case 'discardChanges':
						// Discard uncommitted changes
						const discardSessionId = data.sessionId || sessionId;
						if (discardSessionId) {
							const discardResult = sessionManager.discardChanges(discardSessionId);
							ws.send(JSON.stringify({ type: 'discardResult', result: discardResult }));

							// Send updated git status after discard
							if (discardResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(discardSessionId);
									const targetBranch = ptyManager.getBranchName(discardSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus);
									}
								} catch (error) {
									console.error('Failed to send git status after discard:', error);
								}
							}
						}
						break;

					case 'resetToBase':
						// Reset branch to base
						const resetSessionId = data.sessionId || sessionId;
						if (resetSessionId) {
							const resetResult = sessionManager.resetToBase(resetSessionId);
							ws.send(JSON.stringify({ type: 'resetResult', result: resetResult }));

							// Send updated git status after reset
							if (resetResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(resetSessionId);
									const targetBranch = ptyManager.getBranchName(resetSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus);
									}
								} catch (error) {
									console.error('Failed to send git status after reset:', error);
								}
							}
						}
						break;

					case 'rebase':
						// Rebase branch onto base
						const rebaseSessionId = data.sessionId || sessionId;
						if (rebaseSessionId) {
							const rebaseResult = sessionManager.rebase(rebaseSessionId);
							ws.send(JSON.stringify({ type: 'rebaseResult', result: rebaseResult }));

							// Send updated git status after rebase
							try {
								const gitStatus = sessionManager.getGitStatus(rebaseSessionId);
								const targetBranch = ptyManager.getBranchName(rebaseSessionId);
								if (targetBranch) {
									sendGitBranchStatus(targetBranch, gitStatus);
								}
							} catch (error) {
								console.error('Failed to send git status after rebase:', error);
							}
						}
						break;

					case 'restart':
						// Restart Claude process for this session
						const restartSessionId = data.sessionId || sessionId;
						if (restartSessionId && branchName) {
							// Destroy current PTY process (but keep worktree)
							ptyManager.destroy(restartSessionId, true);

							// Wait for process to fully exit
							setTimeout(() => {
								try {
									// Create new PTY session with same branch (adoptExisting = true)
									const baseUrl = `http://localhost:${HTTP_PORT}`;
									const newSessionId = ptyManager.createSession(
										branchName,
										(sid, output) => {
											if (ws.readyState === ws.OPEN) {
												ws.send(JSON.stringify({ type: 'data', data: output }));
											}
										},
										(sid) => {
											if (ws.readyState === ws.OPEN) {
												ws.send(JSON.stringify({ type: 'exit' }));
											}
										},
										baseUrl,
										true  // adoptExisting
									);

									// Update sessionId to new one
									sessionId = newSessionId;
									ws.send(JSON.stringify({ type: 'restarted', sessionId: newSessionId }));
								} catch (error: any) {
									const errorMessage = error.message || String(error);
									console.error('Failed to restart session:', errorMessage);
									ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
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
				// Preserve worktree on disconnect for auto-restore on next startup
				// The PTY process is killed, but the worktree/branch is preserved
				ptyManager.destroy(sessionId, true);
			}
			if (branchName) {
				unregisterConnection(branchName);
			}
		});

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
		});
	});

	console.log(`WebSocket server started on port ${WS_PORT}`);
}

// Initialize Management WebSocket server
function initManagementWebSocketServer() {
	if (mgmtWss) {
		console.log('Management WebSocket server already running on port ' + MGMT_PORT);
		return;
	}

	mgmtWss = new WebSocketServer({ port: MGMT_PORT });
	globalThis.__mgmtWss = mgmtWss;

	mgmtWss.on('connection', (ws) => {
		// Only accept first client, reject all others
		if (hasManagementClient) {
			console.log('Management connection rejected: port already in use');
			ws.close(1008, 'Port already in use by Claude Hydra');
			return;
		}

		hasManagementClient = true;
		globalThis.__hasManagementClient = true;
		console.log('Management client connected');

		// Cancel any pending shutdown timeout since client (re)connected
		if (shutdownTimeout) {
			console.log('Cancelling pending shutdown - client reconnected');
			clearTimeout(shutdownTimeout);
			shutdownTimeout = null;
		}

		ws.on('close', () => {
			hasManagementClient = false;
			globalThis.__hasManagementClient = false;

			if (isDev) {
				// In development, wait 2 seconds before shutting down to handle HMR
				console.log('Management client disconnected - waiting 2s before shutdown (HMR tolerance)');
				shutdownTimeout = setTimeout(() => {
					console.log('No reconnection within 2s - shutting down server');
					process.exit(0);
				}, 2000);
			} else {
				// In production, shut down immediately
				console.log('Management client disconnected - shutting down server');
				process.exit(0);
			}
		});

		ws.on('error', (error) => {
			console.error('Management WebSocket error:', error);
		});
	});

	console.log(`Management WebSocket server started on port ${MGMT_PORT}`);
}

// Start WebSocket servers
initWebSocketServer();
initManagementWebSocketServer();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
