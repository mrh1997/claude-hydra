import { SessionManager } from './session-manager';

// Singleton instance of SessionManager
// This MUST be initialized by hooks.server.ts on server startup
let sessionManagerInstance: SessionManager | null = null;

/**
 * Gets the singleton SessionManager instance.
 * @throws {Error} If SessionManager has not been initialized by hooks.server.ts
 */
export function getSessionManager(): SessionManager {
	if (!sessionManagerInstance) {
		throw new Error(
			'SessionManager not initialized. This should never happen - hooks.server.ts must initialize it on startup.'
		);
	}
	return sessionManagerInstance;
}

/**
 * Sets the singleton SessionManager instance.
 * Should only be called once by hooks.server.ts during server initialization.
 */
export function setSessionManager(instance: SessionManager): void {
	if (sessionManagerInstance) {
		console.warn('SessionManager instance is being replaced. This may indicate HMR reload.');
	}
	sessionManagerInstance = instance;
}
