import { RepositoryRegistry } from './repository-registry';

// Singleton instance of RepositoryRegistry
// This MUST be initialized by hooks.server.ts on server startup
let repositoryRegistryInstance: RepositoryRegistry | null = null;

/**
 * Gets the singleton RepositoryRegistry instance.
 * @throws {Error} If RepositoryRegistry has not been initialized by hooks.server.ts
 */
export function getRepositoryRegistry(): RepositoryRegistry {
	if (!repositoryRegistryInstance) {
		throw new Error(
			'RepositoryRegistry not initialized. This should never happen - hooks.server.ts must initialize it on startup.'
		);
	}
	return repositoryRegistryInstance;
}

/**
 * Sets the singleton RepositoryRegistry instance.
 * Should only be called once by hooks.server.ts during server initialization.
 */
export function setRepositoryRegistry(instance: RepositoryRegistry): void {
	if (repositoryRegistryInstance) {
		console.warn('RepositoryRegistry instance is being replaced. This may indicate HMR reload.');
	}
	repositoryRegistryInstance = instance;
}
