import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendStateUpdate, sendReadyStateWithGitStatus, sendCloseTabRequest, sendDiscardAndCloseRequest, sendKeepBranchAndCloseRequest, sendWaituserRequest, sendOpenUrlRequest } from '$lib/server/websocket-manager';
import { getRepositoryRegistry } from '$lib/server/session-manager-instance';
import { getFileServerSecret } from '$lib/server/secret-instance';
import { existsSync } from 'fs';
import { resolve, relative, isAbsolute, sep } from 'path';

/**
 * Converts a file path to an HTTP URL for the file server.
 * Detects whether the input is a file path or already a URL.
 *
 * Detection rules:
 * - Starts with '@' → relative file path (strip @ and resolve from worktree root)
 * - Starts with 'http:' or 'https:' → URL (pass through)
 * - Starts with 'file:' → file path (strip prefix and resolve)
 * - Otherwise → check if file exists; if yes, file path; if no, URL
 */
function convertFilePathToUrl(
	input: string,
	worktreePath: string,
	baseUrl: string,
	repohash: string,
	branchname: string
): string {
	// If it starts with "http:" or "https:", it's already a URL
	if (input.startsWith('http:') || input.startsWith('https:')) {
		return input;
	}

	// If it starts with "@", it's a relative file path - strip the @ and treat as file path
	let filePath = input;
	let isExplicitFilePath = false;
	if (input.startsWith('@')) {
		filePath = input.substring(1);
		isExplicitFilePath = true;
	} else if (input.startsWith('file:')) {
		// If it starts with "file:", strip the prefix and treat as file path
		filePath = input.substring(5);
		isExplicitFilePath = true;
		// Remove leading slashes on Windows (file:///C:/path -> C:/path)
		if (process.platform === 'win32' && filePath.startsWith('///')) {
			filePath = filePath.substring(3);
		} else if (filePath.startsWith('//')) {
			filePath = filePath.substring(2);
		}
	}

	// Resolve the file path (handles both relative and absolute paths)
	// Relative paths are resolved from worktree root
	const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(worktreePath, filePath);

	// Check if the file exists
	if (!existsSync(absolutePath)) {
		// If explicitly marked as file path (@prefix or file: prefix), but file doesn't exist,
		// still return as-is (will likely fail when opened, but that's expected)
		if (isExplicitFilePath) {
			// Fall through to convert to URL even if file doesn't exist
		} else {
			// Not explicitly a file path and doesn't exist - assume it's a URL
			return input;
		}
	}

	// File exists - convert to HTTP URL
	// Calculate relative path from worktree root
	let relativePath = relative(worktreePath, absolutePath);

	// Convert Windows backslashes to forward slashes for URL
	relativePath = relativePath.split(sep).join('/');

	// Get the secret
	const secret = getFileServerSecret();

	// Construct the file server URL
	const fileUrl = `${baseUrl}/files/${encodeURIComponent(secret)}/${encodeURIComponent(repohash)}/${encodeURIComponent(branchname)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;

	return fileUrl;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const { repohash, branchname } = params;
	const body = await request.json();
	const { state, text, commandline, mode, url, instructions, hidden } = body;

	// Validate state
	if (state !== 'ready' && state !== 'running' && state !== 'close' && state !== 'waituser' && state !== 'openurl') {
		return json({ error: 'Invalid state' }, { status: 400 });
	}

	// Validate waituser parameters
	if (state === 'waituser' && !commandline) {
		return json({ error: 'waituser state requires commandline parameter' }, { status: 400 });
	}

	// Validate openurl parameters
	if (state === 'openurl' && (!url || !instructions)) {
		return json({ error: 'openurl state requires url and instructions parameters' }, { status: 400 });
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
	} else if (state === 'openurl') {
		// For 'openurl' state, convert file paths to URLs and send openurl request
		const registry = getRepositoryRegistry();
		const sessionId = registry.getSessionIdByRepoHashAndBranch(repohash, branchname);

		if (!sessionId) {
			return json({ error: 'No active session for this repository and branch' }, { status: 404 });
		}

		const sessionManager = registry.getRepositoryBySessionId(sessionId);
		if (!sessionManager) {
			return json({ error: 'No session manager found' }, { status: 404 });
		}

		// Get the worktree path
		const allSessions = sessionManager.getAllSessions();
		const sessionInfo = allSessions.get(sessionId);

		if (!sessionInfo) {
			return json({ error: 'Session info not found' }, { status: 404 });
		}

		// Get base URL from request origin
		const baseUrl = request.headers.get('origin') || `${request.url.split('/')[0]}//${request.url.split('/')[2]}`;

		// Convert file path to URL if needed
		const finalUrl = convertFilePathToUrl(url, sessionInfo.worktreePath, baseUrl, repohash, branchname);

		sent = sendOpenUrlRequest(repohash, branchname, finalUrl, instructions, hidden || false);
	} else {
		// For 'running' state, just send state update
		sent = sendStateUpdate(repohash, branchname, state);
	}

	if (!sent) {
		return json({ error: 'No active session for this repository and branch' }, { status: 404 });
	}

	return json({ success: true });
};
