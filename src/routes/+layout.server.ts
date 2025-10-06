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

	return {
		version
	};
}
