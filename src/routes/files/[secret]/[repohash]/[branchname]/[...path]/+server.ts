import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRepositoryRegistry } from '$lib/server/session-manager-instance';
import { getFileServerSecret } from '$lib/server/secret-instance';
import { createReadStream, statSync, existsSync } from 'fs';
import { join, normalize, relative, sep } from 'path';
import { lookup as mimeLookup } from 'mrmime';

export const GET: RequestHandler = async ({ params }) => {
	const { secret, repohash, branchname, path } = params;

	// Validate secret
	const validSecret = getFileServerSecret();
	if (secret !== validSecret) {
		throw error(403, 'Access denied: Invalid secret');
	}

	// Get the repository registry
	const registry = getRepositoryRegistry();

	// Find session ID for this repo and branch
	const sessionId = registry.getSessionIdByRepoHashAndBranch(repohash, branchname);

	if (!sessionId) {
		throw error(404, 'No active session for this repository and branch');
	}

	// Get the session manager
	const sessionManager = registry.getRepositoryBySessionId(sessionId);

	if (!sessionManager) {
		throw error(404, 'Session manager not found');
	}

	// Get all sessions and find the one we need
	const allSessions = sessionManager.getAllSessions();
	const sessionInfo = allSessions.get(sessionId);

	if (!sessionInfo) {
		throw error(404, 'Session info not found');
	}

	const worktreePath = sessionInfo.worktreePath;

	// Decode and normalize the requested path
	const decodedPath = decodeURIComponent(path || '');

	// Join with worktree path and resolve to absolute path
	const absoluteFilePath = normalize(join(worktreePath, decodedPath));

	// Security check: ensure the resolved path is within the worktree
	const relativePath = relative(worktreePath, absoluteFilePath);
	const isWithinWorktree = !relativePath.startsWith('..') && !relativePath.startsWith(sep + '..');

	if (!isWithinWorktree) {
		throw error(403, 'Access denied: Path is outside worktree');
	}

	// Check if file exists
	if (!existsSync(absoluteFilePath)) {
		throw error(404, 'File not found');
	}

	// Get file stats
	let stats;
	try {
		stats = statSync(absoluteFilePath);
	} catch (err) {
		throw error(500, 'Failed to read file stats');
	}

	// If it's a directory, return 404 (as per requirements - no directory listings)
	if (stats.isDirectory()) {
		throw error(404, 'Directory listing not supported');
	}

	// Determine MIME type
	const mimeType = mimeLookup(absoluteFilePath) || 'application/octet-stream';

	// Create read stream
	const stream = createReadStream(absoluteFilePath);

	// Return response with appropriate headers
	return new Response(stream as any, {
		headers: {
			'Content-Type': mimeType,
			'Content-Length': stats.size.toString(),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-cache'
		}
	});
};
