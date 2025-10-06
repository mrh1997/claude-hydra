import { dev } from '$app/environment';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function load() {
	let version = '';

	if (dev) {
		try {
			// Get first 4 characters of git hash
			const gitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().substring(0, 4);
			version = gitHash;

			// Check if MODVERSION file exists
			const modVersionPath = join(process.cwd(), 'MODVERSION');
			if (existsSync(modVersionPath)) {
				const modVersion = readFileSync(modVersionPath, 'utf8').trim();
				if (modVersion) {
					version += `-${modVersion}`;
				}
			}
		} catch (error) {
			console.error('Failed to get version:', error);
		}
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
