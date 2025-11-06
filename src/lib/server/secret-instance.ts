import { randomBytes } from 'crypto';

// Singleton instance of the file server secret
// This MUST be initialized by hooks.server.ts on server startup
let fileServerSecretInstance: string | null = null;

/**
 * Generates a 16-character alphanumeric secret for the file server.
 * Uses crypto.randomBytes for secure random generation.
 */
function generateSecret(): string {
	const bytes = randomBytes(12); // 12 bytes = 16 base64 chars (after removing special chars)
	// Convert to base64 and remove non-alphanumeric characters
	return bytes
		.toString('base64')
		.replace(/[^a-zA-Z0-9]/g, '')
		.slice(0, 16);
}

/**
 * Gets the singleton file server secret.
 * The secret is generated once on first access and persists across HMR reloads.
 * @returns {string} The 16-character alphanumeric secret
 */
export function getFileServerSecret(): string {
	// Check if already initialized in current process
	if (fileServerSecretInstance) {
		return fileServerSecretInstance;
	}

	// Check if persisted in globalThis (for HMR reload persistence)
	if ((globalThis as any).__fileServerSecret) {
		const restoredSecret = (globalThis as any).__fileServerSecret as string;
		fileServerSecretInstance = restoredSecret;
		console.log('[FileServerSecret] Restored secret from globalThis (HMR reload)');
		return restoredSecret;
	}

	// Generate new secret
	fileServerSecretInstance = generateSecret();
	(globalThis as any).__fileServerSecret = fileServerSecretInstance;
	console.log('[FileServerSecret] Generated new secret:', fileServerSecretInstance);

	return fileServerSecretInstance;
}

/**
 * Sets the file server secret.
 * Should only be called once by hooks.server.ts during initialization.
 * Primarily used to ensure secret is generated early in the startup process.
 */
export function initializeFileServerSecret(): void {
	getFileServerSecret();
}
