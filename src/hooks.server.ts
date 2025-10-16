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

// Check if we're in headless mode (set by claude-hydra-server.js)
const isHeadless = process.env.IS_HEADLESS === 'true';

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

		ws.on('message', async (message) => {
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

						sessionId = await ptyManager.createSession(
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
						// At this point branchName is guaranteed to be non-null
						registerConnection(branchName!, ws);

						// When adopting existing worktree, send initial git status immediately
						// (connection must be registered first for the message to be sent)
						if (adoptExisting) {
							try {
								const gitStatus = sessionManager.getGitStatus(sessionId);
								const commitLog = sessionManager.getCommitLog(sessionId);
								sendGitBranchStatus(branchName!, gitStatus, commitLog);
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
								const gitStatus = sessionManager.getGitStatus(statusSessionId);
								const commitLog = sessionManager.getCommitLog(statusSessionId);
								const targetBranch = ptyManager.getBranchName(statusSessionId);
								if (targetBranch) {
									// Use broadcast mechanism to send git status with commit log
									sendGitBranchStatus(targetBranch, gitStatus, commitLog);
								}
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to get git status:', errorMessage);
								ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
							}
						}
						break;

					case 'merge':
						// Merge session branch to base branch (non-blocking)
						// Accept sessionId from message payload or use connection's sessionId
						const mergeSessionId = data.sessionId || sessionId;
						if (mergeSessionId) {
							// Don't await - run async to keep WebSocket responsive during long operations
							sessionManager.merge(mergeSessionId, data.commitMessage).then((result) => {
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'mergeResult', result }));
								}

								// After successful merge, broadcast updated git status to all tabs
								if (result.success) {
									broadcastGitStatusToAll(
										sessionManager.getAllSessions(),
										(sid) => sessionManager.getGitStatus(sid)
									);
								}
							}).catch((error) => {
								console.error('Merge error:', error);
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'mergeResult', result: { success: false, error: error.message } }));
								}
							});
						}
						break;

					case 'commit':
						// Commit changes in session
						const commitSessionId = data.sessionId || sessionId;
						if (commitSessionId) {
							const commitResult = sessionManager.commit(commitSessionId, data.commitMessage);
							ws.send(JSON.stringify({ type: 'commitResult', result: commitResult }));

							// Send updated git status with commit log after commit
							if (commitResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(commitSessionId);
									const commitLog = sessionManager.getCommitLog(commitSessionId);
									const targetBranch = ptyManager.getBranchName(commitSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
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

							// Send updated git status with commit log after discard
							if (discardResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(discardSessionId);
									const commitLog = sessionManager.getCommitLog(discardSessionId);
									const targetBranch = ptyManager.getBranchName(discardSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
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

							// Send updated git status with commit log after reset
							if (resetResult.success) {
								try {
									const gitStatus = sessionManager.getGitStatus(resetSessionId);
									const commitLog = sessionManager.getCommitLog(resetSessionId);
									const targetBranch = ptyManager.getBranchName(resetSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
									}
								} catch (error) {
									console.error('Failed to send git status after reset:', error);
								}
							}
						}
						break;

					case 'rebase':
						// Rebase branch onto base (non-blocking)
						const rebaseSessionId = data.sessionId || sessionId;
						if (rebaseSessionId) {
							// Don't await - run async to keep WebSocket responsive during long operations
							sessionManager.rebase(rebaseSessionId).then((rebaseResult) => {
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'rebaseResult', result: rebaseResult }));
								}

								// Send updated git status with commit log after rebase
								try {
									const gitStatus = sessionManager.getGitStatus(rebaseSessionId);
									const commitLog = sessionManager.getCommitLog(rebaseSessionId);
									const targetBranch = ptyManager.getBranchName(rebaseSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
									}
								} catch (error) {
									console.error('Failed to send git status after rebase:', error);
								}
							}).catch((error) => {
								console.error('Rebase error:', error);
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'rebaseResult', result: { success: false, error: error.message } }));
								}
							});
						}
						break;

					case 'restart':
						// Restart Claude process for this session
						const restartSessionId = data.sessionId || sessionId;
						if (restartSessionId && branchName) {
							// Capture branchName for closure
							const capturedBranchName = branchName;

							// Destroy current PTY process (but keep worktree)
							ptyManager.destroy(restartSessionId, true);

							// Wait for process to fully exit
							setTimeout(async () => {
								try {
									// Create new PTY session with same branch (adoptExisting = true)
									const baseUrl = `http://localhost:${HTTP_PORT}`;
									const newSessionId = await ptyManager.createSession(
										capturedBranchName,
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

					case 'requestFileList':
						// Get file list for a commit or working tree
						const fileListSessionId = data.sessionId || sessionId;
						if (fileListSessionId) {
							try {
								const commitId = data.commitId || null; // null means working tree
								const fileList = sessionManager.getFileList(fileListSessionId, commitId);
								ws.send(JSON.stringify({
									type: 'fileList',
									commitId,
									files: fileList
								}));
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to get file list:', errorMessage);
								ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
							}
						}
						break;

					case 'deleteFile':
						// Delete a file or directory in the worktree
						const deleteSessionId = data.sessionId || sessionId;
						if (deleteSessionId) {
							try {
								const result = sessionManager.deleteFileOrDirectory(deleteSessionId, data.path);
								ws.send(JSON.stringify({ type: 'deleteFileResult', result }));

								// Refresh file list and git status after deletion
								if (result.success) {
									try {
										const fileList = sessionManager.getFileList(deleteSessionId, null);
										ws.send(JSON.stringify({
											type: 'fileList',
											commitId: null,
											files: fileList
										}));

										// Update git status
										const gitStatus = sessionManager.getGitStatus(deleteSessionId);
										const commitLog = sessionManager.getCommitLog(deleteSessionId);
										const targetBranch = ptyManager.getBranchName(deleteSessionId);
										if (targetBranch) {
											sendGitBranchStatus(targetBranch, gitStatus, commitLog);
										}
									} catch (error) {
										console.error('Failed to refresh file list after delete:', error);
									}
								}
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to delete file:', errorMessage);
								ws.send(JSON.stringify({ type: 'deleteFileResult', result: { success: false, error: errorMessage } }));
							}
						}
						break;

					case 'createFile':
						// Create a file or directory in the worktree
						const createSessionId = data.sessionId || sessionId;
						if (createSessionId) {
							try {
								const result = sessionManager.createFileOrDirectory(createSessionId, data.path, data.isDirectory);
								ws.send(JSON.stringify({ type: 'createFileResult', result }));

								// Refresh file list and git status after creation
								if (result.success) {
									try {
										const fileList = sessionManager.getFileList(createSessionId, null);
										ws.send(JSON.stringify({
											type: 'fileList',
											commitId: null,
											files: fileList
										}));

										// Update git status
										const gitStatus = sessionManager.getGitStatus(createSessionId);
										const commitLog = sessionManager.getCommitLog(createSessionId);
										const targetBranch = ptyManager.getBranchName(createSessionId);
										if (targetBranch) {
											sendGitBranchStatus(targetBranch, gitStatus, commitLog);
										}
									} catch (error) {
										console.error('Failed to refresh file list after create:', error);
									}
								}
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to create file:', errorMessage);
								ws.send(JSON.stringify({ type: 'createFileResult', result: { success: false, error: errorMessage } }));
							}
						}
						break;

					case 'getFileDiff':
						// Get diff for a specific file
						const diffSessionId = data.sessionId || sessionId;
						if (diffSessionId) {
							try {
								const diff = sessionManager.getFileDiff(diffSessionId, data.filePath, data.commitId || null);
								ws.send(JSON.stringify({
									type: 'fileDiff',
									original: diff.original,
									modified: diff.modified
								}));
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to get file diff:', errorMessage);
								ws.send(JSON.stringify({ type: 'error', error: errorMessage }));
							}
						}
						break;

					case 'saveFile':
						// Save file content to disk
						const saveSessionId = data.sessionId || sessionId;
						if (saveSessionId) {
							try {
								sessionManager.saveFile(saveSessionId, data.filePath, data.content);
								ws.send(JSON.stringify({ type: 'fileSaved', success: true }));

								// Refresh git status after save
								try {
									const gitStatus = sessionManager.getGitStatus(saveSessionId);
									const commitLog = sessionManager.getCommitLog(saveSessionId);
									const targetBranch = ptyManager.getBranchName(saveSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
									}
								} catch (error) {
									console.error('Failed to send git status after save:', error);
								}
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to save file:', errorMessage);
								ws.send(JSON.stringify({ type: 'fileSaved', success: false, error: errorMessage }));
							}
						}
						break;

					case 'discardFile':
						// Discard changes to a specific file
						const discardFileSessionId = data.sessionId || sessionId;
						if (discardFileSessionId) {
							try {
								sessionManager.discardFile(discardFileSessionId, data.filePath);
								ws.send(JSON.stringify({ type: 'fileDiscarded', success: true }));

								// Refresh git status and file diff after discard
								try {
									const gitStatus = sessionManager.getGitStatus(discardFileSessionId);
									const commitLog = sessionManager.getCommitLog(discardFileSessionId);
									const targetBranch = ptyManager.getBranchName(discardFileSessionId);
									if (targetBranch) {
										sendGitBranchStatus(targetBranch, gitStatus, commitLog);
									}

									// Send updated file diff
									const diff = sessionManager.getFileDiff(discardFileSessionId, data.filePath, null);
									ws.send(JSON.stringify({
										type: 'fileDiff',
										original: diff.original,
										modified: diff.modified
									}));
								} catch (error) {
									console.error('Failed to send git status after discard:', error);
								}
							} catch (error: any) {
								const errorMessage = error.message || String(error);
								console.error('Failed to discard file:', errorMessage);
								ws.send(JSON.stringify({ type: 'fileDiscarded', success: false, error: errorMessage }));
							}
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

			if (isHeadless) {
				// In headless mode, allow sequential sessions - don't shutdown
				console.log('Management client disconnected - allowing next connection (headless mode)');
			} else {
				// Wait 5 seconds before shutting down to handle page reloads and HMR
				console.log('Management client disconnected - waiting 5s before shutdown');
				shutdownTimeout = setTimeout(() => {
					console.log('No reconnection within 5s - shutting down server');
					process.exit(0);
				}, 5000);
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
