import { dev } from '$app/environment';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export async function load() {
	let version = '';

	if (dev) {
		try {
			// Get the source directory (claude-hydra repo root)
			// This file is at src/routes/+layout.server.ts, so go up 2 levels
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = dirname(__filename);
			const sourceDir = join(__dirname, '..', '..');

			// Get first 4 characters of git hash from source repo
			const gitHash = execSync('git rev-parse HEAD', { cwd: sourceDir, encoding: 'utf8' }).trim().substring(0, 4);
			version = gitHash;

			// Check if .claude-hydra.devversion file exists in source repo
			const devVersionPath = join(sourceDir, '.claude-hydra.devversion');
			if (existsSync(devVersionPath)) {
				const devVersion = readFileSync(devVersionPath, 'utf8').trim();
				if (devVersion) {
					version += `-${devVersion}`;
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
