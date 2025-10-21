/**
 * Utilities for managing repository history in localStorage
 */

const STORAGE_KEY = 'claude-hydra:repo-history';
const OPEN_REPOS_KEY = 'claude-hydra:open-repositories';
const MAX_HISTORY_SIZE = 20;

/**
 * Normalizes a repository path for comparison
 * - Resolves to absolute path
 * - Normalizes separators
 * - Converts to lowercase on Windows for case-insensitive comparison
 */
export function normalizePath(repoPath: string): string {
	// Remove trailing slashes/backslashes
	let normalized = repoPath.replace(/[/\\]+$/, '');

	// Normalize slashes to forward slashes
	normalized = normalized.replace(/\\/g, '/');

	// On Windows, convert to lowercase for case-insensitive comparison
	// Check if this looks like a Windows path (starts with drive letter)
	if (/^[a-zA-Z]:/.test(normalized)) {
		normalized = normalized.toLowerCase();
	}

	return normalized;
}

/**
 * Retrieves the repository history from localStorage
 * @returns Array of repository paths, most recent first
 */
export function getRepoHistory(): string[] {
	if (typeof window === 'undefined') return [];

	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return [];

		const history = JSON.parse(stored);
		return Array.isArray(history) ? history : [];
	} catch (error) {
		console.error('Failed to load repository history:', error);
		return [];
	}
}

/**
 * Adds a repository to the history or moves it to the top if it already exists
 * @param repoPath - The repository path to add
 */
export function addRepoToHistory(repoPath: string): void {
	if (typeof window === 'undefined') return;

	try {
		const normalized = normalizePath(repoPath);
		let history = getRepoHistory();

		// Remove existing entry (case-insensitive on Windows)
		history = history.filter(path => normalizePath(path) !== normalized);

		// Add to front of list
		history.unshift(repoPath); // Use original path, not normalized

		// Limit history size
		if (history.length > MAX_HISTORY_SIZE) {
			history = history.slice(0, MAX_HISTORY_SIZE);
		}

		localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch (error) {
		console.error('Failed to save repository history:', error);
	}
}

/**
 * Removes a repository from the history
 * @param repoPath - The repository path to remove
 */
export function removeRepoFromHistory(repoPath: string): void {
	if (typeof window === 'undefined') return;

	try {
		const normalized = normalizePath(repoPath);
		let history = getRepoHistory();

		history = history.filter(path => normalizePath(path) !== normalized);

		localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch (error) {
		console.error('Failed to remove from repository history:', error);
	}
}

/**
 * Retrieves the list of currently open repositories from localStorage
 * @returns Array of repository paths in order
 */
export function getOpenRepositories(): string[] {
	if (typeof window === 'undefined') return [];

	try {
		const stored = localStorage.getItem(OPEN_REPOS_KEY);
		if (!stored) return [];

		const repos = JSON.parse(stored);
		return Array.isArray(repos) ? repos : [];
	} catch (error) {
		console.error('Failed to load open repositories:', error);
		return [];
	}
}

/**
 * Saves the list of currently open repositories to localStorage
 * @param repoPaths - Array of repository paths in order
 */
export function saveOpenRepositories(repoPaths: string[]): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify(repoPaths));
	} catch (error) {
		console.error('Failed to save open repositories:', error);
	}
}

/**
 * Clears the list of open repositories from localStorage
 */
export function clearOpenRepositories(): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.removeItem(OPEN_REPOS_KEY);
	} catch (error) {
		console.error('Failed to clear open repositories:', error);
	}
}
