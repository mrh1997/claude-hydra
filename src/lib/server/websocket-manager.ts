import type { WebSocket } from 'ws';
import type { GitStatus, SessionInfo, CommitInfo } from './session-manager';
import { getRepositoryRegistry } from './session-manager-instance';

// Persist branchConnections across HMR reloads
declare global {
	var __branchConnections: Map<string, WebSocket> | null;
}

// Map branchname to WebSocket connection
const branchConnections = globalThis.__branchConnections || new Map<string, WebSocket>();
globalThis.__branchConnections = branchConnections;

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

export function sendGitBranchStatus(branchName: string, gitStatus: GitStatus, commitLog?: CommitInfo[]): boolean {
	const ws = branchConnections.get(branchName);
	if (ws && ws.readyState === ws.OPEN) {
		const message: any = { type: 'gitBranchStatus', gitStatus };
		if (commitLog !== undefined) {
			message.commitLog = commitLog;
		}
		ws.send(JSON.stringify(message));
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

export function sendReadyStateWithGitStatus(branchName: string): boolean {
	// Send state update
	const sent = sendStateUpdate(branchName, 'ready');

	if (!sent) {
		return false;
	}

	// Check if base branch has changed and get the session manager
	const registry = getRepositoryRegistry();
	const sessionId = registry.getSessionIdByBranch(branchName);
	if (sessionId) {
		const sessionManager = registry.getRepositoryBySessionId(sessionId);
		if (sessionManager) {
			// Check if this session's base branch commit has changed
			const baseBranchChanged = sessionManager.checkAndUpdateBaseBranch(sessionId);

			if (baseBranchChanged) {
				// This session's base branch changed - broadcast to all sessions using the same base branch
				const allSessions = sessionManager.getAllSessions();
				const currentSession = allSessions.get(sessionId);

				if (currentSession) {
					const changedBaseBranch = currentSession.baseBranchName;
					console.log(`Base branch ${changedBaseBranch} changed - broadcasting to all sessions using it`);

					// Broadcast to all sessions that use the same base branch
					for (const [sid, session] of allSessions) {
						if (session.baseBranchName === changedBaseBranch) {
							try {
								const gitStatus = sessionManager.getGitStatus(sid);

								// Include commit log in broadcast
								let commitLog: CommitInfo[] | undefined = undefined;
								try {
									commitLog = sessionManager.getCommitLog(sid);
								} catch (commitLogError) {
									console.error(`Failed to get commit log for session ${sid}:`, commitLogError);
								}

								sendGitBranchStatus(session.branchName, gitStatus, commitLog);
							} catch (error) {
								console.error(`Failed to broadcast git status for session ${sid}:`, error);
							}
						}
					}

					// Update terminals that ARE the base branch itself
					for (const [sid, session] of allSessions) {
						// Check if this session IS on the changed base branch (but has a different base)
						if (session.branchName === changedBaseBranch && session.baseBranchName !== changedBaseBranch) {
							try {
								const gitStatus = sessionManager.getGitStatus(sid);

								let commitLog: CommitInfo[] | undefined = undefined;
								try {
									commitLog = sessionManager.getCommitLog(sid);
								} catch (commitLogError) {
									console.error(`Failed to get commit log for session ${sid}:`, commitLogError);
								}

								sendGitBranchStatus(session.branchName, gitStatus, commitLog);
								console.log(`Updated terminal for base branch ${changedBaseBranch} itself (session ${sid})`);
							} catch (error) {
								console.error(`Failed to update base branch terminal ${sid}:`, error);
							}
						}
					}
				}
			} else {
				// Base branch unchanged - just update current tab's git status
				try {
					const gitStatus = sessionManager.getGitStatus(sessionId);

					// Try to get commit log, but don't fail if it's unavailable
					let commitLog: CommitInfo[] | undefined = undefined;
					try {
						commitLog = sessionManager.getCommitLog(sessionId);
					} catch (commitLogError) {
						console.error(`Failed to get commit log for branch ${branchName}:`, commitLogError);
						// Continue anyway - we can still send the git status without commit log
					}

					sendGitBranchStatus(branchName, gitStatus, commitLog);
				} catch (error) {
					console.error(`Failed to get git status for branch ${branchName}:`, error);
				}
			}
		}
	}

	return true;
}

export function sendCloseTabRequest(branchName: string): boolean {
	const ws = branchConnections.get(branchName);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify({ type: 'closeTab' }));
		return true;
	}
	return false;
}

export function sendWaituserRequest(branchName: string, text: string, commandline: string): boolean {
	const ws = branchConnections.get(branchName);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify({ type: 'waituser', text, commandline }));
		return true;
	}
	return false;
}
