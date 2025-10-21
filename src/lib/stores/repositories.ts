import { writable } from 'svelte/store';
import { addRepoToHistory, saveOpenRepositories } from '$lib/utils/repoHistory';

export interface Repository {
	path: string;
	name: string;
}

/**
 * Extracts the last part of a path (basename)
 * Works with both forward slashes and backslashes
 */
function getBasename(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(p => p);
	return parts[parts.length - 1] || path;
}

function createRepositoriesStore() {
	const { subscribe, set, update } = writable<Repository[]>([]);

	// Helper to persist repositories to localStorage
	function persistRepositories(repos: Repository[]) {
		saveOpenRepositories(repos.map(r => r.path));
	}

	return {
		subscribe,

		/**
		 * Adds a new repository to the list
		 * @param repoPath - Absolute path to the repository
		 */
		addRepository: (repoPath: string) => {
			update(repos => {
				// Check if repository already exists
				if (repos.some(repo => repo.path === repoPath)) {
					return repos;
				}

				// Extract repository name from path (last part of path)
				const name = getBasename(repoPath);

				// Add to localStorage history
				addRepoToHistory(repoPath);

				const newRepos = [...repos, { path: repoPath, name }];
				persistRepositories(newRepos);
				return newRepos;
			});
		},

		/**
		 * Removes a repository from the list
		 * @param repoPath - Path of the repository to remove
		 */
		removeRepository: (repoPath: string) => {
			update(repos => {
				const newRepos = repos.filter(repo => repo.path !== repoPath);
				persistRepositories(newRepos);
				return newRepos;
			});
		},

		/**
		 * Clears all repositories
		 */
		clear: () => {
			set([]);
			persistRepositories([]);
		},

		/**
		 * Sets the repositories list (used for restoring from localStorage)
		 * @param repoPaths - Array of repository paths to restore
		 */
		restoreRepositories: (repoPaths: string[]) => {
			const repos = repoPaths.map(path => ({
				path,
				name: getBasename(path)
			}));
			set(repos);
		}
	};
}

export const repositories = createRepositoriesStore();
