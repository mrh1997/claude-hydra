import { SessionManager } from './session-manager';
import { resolve } from 'path';

/**
 * RepositoryRegistry manages multiple SessionManager instances,
 * one for each repository that the user has opened.
 *
 * This enables Claude Hydra to work with multiple repositories simultaneously,
 * with each repository maintaining its own worktrees and base branch.
 */
export class RepositoryRegistry {
	private repositories = new Map<string, SessionManager>();
	private sessionToRepo = new Map<string, string>();

	/**
	 * Normalizes a repository path for consistent lookups.
	 * Uses the same normalization as SessionManager.normalizePathForHash() to ensure consistency.
	 * - Resolves . and .. and symbolic links
	 * - Converts to uppercase on Windows for case-insensitive filesystem consistency
	 * @param repoPath - The repository path to normalize
	 * @returns Normalized path suitable for Map key
	 */
	private normalizePath(repoPath: string): string {
		const resolved = resolve(repoPath);
		return process.platform === 'win32' ? resolved.toUpperCase() : resolved;
	}

	/**
	 * Creates or retrieves a SessionManager for the given repository path.
	 * @param repoPath - Absolute path to the repository
	 * @returns The SessionManager instance for this repository
	 */
	getOrCreateRepository(repoPath: string): SessionManager {
		const normalizedPath = this.normalizePath(repoPath);

		if (!this.repositories.has(normalizedPath)) {
			console.log(`Creating SessionManager for repository: ${normalizedPath}`);
			const sessionManager = new SessionManager(repoPath);
			this.repositories.set(normalizedPath, sessionManager);
		}

		return this.repositories.get(normalizedPath)!;
	}

	/**
	 * Registers a session with its repository.
	 * This enables routing of WebSocket messages by sessionId.
	 * @param sessionId - The session ID
	 * @param repoPath - The repository path
	 */
	registerSession(sessionId: string, repoPath: string): void {
		const normalizedPath = this.normalizePath(repoPath);
		this.sessionToRepo.set(sessionId, normalizedPath);
		console.log(`Registered session ${sessionId} to repository ${normalizedPath}`);
	}

	/**
	 * Unregisters a session from its repository.
	 * @param sessionId - The session ID
	 */
	unregisterSession(sessionId: string): void {
		this.sessionToRepo.delete(sessionId);
		console.log(`Unregistered session ${sessionId}`);
	}

	/**
	 * Gets the SessionManager for a given session ID.
	 * @param sessionId - The session ID
	 * @returns The SessionManager managing this session, or undefined if not found
	 */
	getRepositoryBySessionId(sessionId: string): SessionManager | undefined {
		const repoPath = this.sessionToRepo.get(sessionId);
		if (!repoPath) {
			return undefined;
		}
		return this.repositories.get(repoPath);
	}

	/**
	 * Gets the session ID for a given branch name by searching all repositories.
	 * @param branchName - The branch name to look up
	 * @returns The session ID if found, undefined otherwise
	 */
	getSessionIdByBranch(branchName: string): string | undefined {
		for (const sessionManager of this.repositories.values()) {
			const sessionId = sessionManager.getSessionIdByBranch(branchName);
			if (sessionId) {
				return sessionId;
			}
		}
		return undefined;
	}

	/**
	 * Gets the SessionManager for a given branch name by searching all repositories.
	 * @param branchName - The branch name to look up
	 * @returns The SessionManager managing this branch, or undefined if not found
	 */
	getRepositoryByBranch(branchName: string): SessionManager | undefined {
		for (const sessionManager of this.repositories.values()) {
			const sessionId = sessionManager.getSessionIdByBranch(branchName);
			if (sessionId) {
				return sessionManager;
			}
		}
		return undefined;
	}

	/**
	 * Gets the session ID for a given repository hash and branch name combination.
	 * This provides unique identification when multiple repositories have the same branch name.
	 * @param repoHash - The repository hash (8-character MD5 hash)
	 * @param branchName - The branch name to look up
	 * @returns The session ID if found, undefined otherwise
	 */
	getSessionIdByRepoHashAndBranch(repoHash: string, branchName: string): string | undefined {
		for (const sessionManager of this.repositories.values()) {
			// Check if this SessionManager's repoHash matches
			if (sessionManager.getRepoHash() === repoHash) {
				// Found matching repository, now look up the branch
				const sessionId = sessionManager.getSessionIdByBranch(branchName);
				if (sessionId) {
					return sessionId;
				}
			}
		}
		return undefined;
	}

	/**
	 * Closes a repository and destroys all its sessions.
	 * @param repoPath - The repository path to close
	 */
	closeRepository(repoPath: string): void {
		const normalizedPath = this.normalizePath(repoPath);
		const sessionManager = this.repositories.get(normalizedPath);

		if (sessionManager) {
			console.log(`Closing repository: ${normalizedPath}`);
			// Destroy all sessions for this repository
			sessionManager.destroyAllSessions();
			this.repositories.delete(normalizedPath);

			// Clean up session mappings
			for (const [sessionId, path] of this.sessionToRepo.entries()) {
				if (path === normalizedPath) {
					this.sessionToRepo.delete(sessionId);
				}
			}
		}
	}

	/**
	 * Gets all repository paths that are currently open.
	 * @returns Array of repository paths
	 */
	getOpenRepositories(): string[] {
		return Array.from(this.repositories.keys());
	}

	/**
	 * Closes all repositories and cleans up all sessions.
	 */
	closeAllRepositories(): void {
		console.log('Closing all repositories');
		for (const sessionManager of this.repositories.values()) {
			sessionManager.destroyAllSessions();
		}
		this.repositories.clear();
		this.sessionToRepo.clear();
	}
}
