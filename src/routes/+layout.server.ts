import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Finds package.json by walking up the directory tree from the given starting directory.
 * This works in both development and production environments.
 */
function findPackageJson(startDir: string): string | null {
	let currentDir = startDir;

	// Walk up the directory tree (max 10 levels to prevent infinite loops)
	for (let i = 0; i < 10; i++) {
		const packageJsonPath = join(currentDir, 'package.json');

		if (existsSync(packageJsonPath)) {
			try {
				const content = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
				// Verify it's the claude-hydra package by checking the name
				if (content.name === 'claude-hydra') {
					return packageJsonPath;
				}
			} catch {
				// Invalid JSON, continue searching
			}
		}

		const parentDir = dirname(currentDir);
		// Stop if we've reached the root
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	return null;
}

export async function load() {
	let version = '';

	try {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);

		// Find package.json by walking up the directory tree
		const packageJsonPath = findPackageJson(__dirname);

		if (packageJsonPath) {
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			const pkgVersion = packageJson.version || '';

			// Only display version if it's not 0.0.0
			if (pkgVersion !== '0.0.0') {
				version = `claude-hydra@${pkgVersion}`;
			}
		}
	} catch (error) {
		console.error('Failed to get version:', error);
	}

	// Read WebSocket ports from environment variables set by claude-hydra-server.js
	const websocketPort = parseInt(process.env.WS_PORT || '3001', 10);
	const managementPort = parseInt(process.env.MGMT_PORT || '3002', 10);

	return {
		version,
		websocketPort,
		managementPort
	};
}
