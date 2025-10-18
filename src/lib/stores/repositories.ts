import { writable } from 'svelte/store';

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

				return [...repos, { path: repoPath, name }];
			});
		},

		/**
		 * Removes a repository from the list
		 * @param repoPath - Path of the repository to remove
		 */
		removeRepository: (repoPath: string) => {
			update(repos => repos.filter(repo => repo.path !== repoPath));
		},

		/**
		 * Clears all repositories
		 */
		clear: () => set([])
	};
}

export const repositories = createRepositoriesStore();
