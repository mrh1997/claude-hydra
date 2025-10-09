import { writable } from 'svelte/store';
import type { GitBackend } from '$lib/GitBackend';

/**
 * Store for GitBackend instances, mapped by sessionId
 */
function createGitBackendsStore() {
	const { subscribe, set, update } = writable<Map<string, GitBackend>>(new Map());

	return {
		subscribe,

		/**
		 * Register a GitBackend instance for a session
		 */
		register: (sessionId: string, gitBackend: GitBackend) => {
			update(backends => {
				backends.set(sessionId, gitBackend);
				return backends;
			});
		},

		/**
		 * Unregister a GitBackend instance
		 */
		unregister: (sessionId: string) => {
			update(backends => {
				const backend = backends.get(sessionId);
				if (backend) {
					backend.dispose();
					backends.delete(sessionId);
				}
				return backends;
			});
		},

		/**
		 * Get a GitBackend instance by sessionId
		 */
		get: (sessionId: string): GitBackend | undefined => {
			let result: GitBackend | undefined;
			update(backends => {
				result = backends.get(sessionId);
				return backends;
			});
			return result;
		},

		/**
		 * Clear all backends
		 */
		clear: () => {
			update(backends => {
				for (const backend of backends.values()) {
					backend.dispose();
				}
				backends.clear();
				return backends;
			});
		}
	};
}

export const gitBackends = createGitBackendsStore();
