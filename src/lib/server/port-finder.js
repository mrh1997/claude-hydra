import { createServer } from 'net';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Tries to bind to a port and returns whether it's available
 */
export async function isPortAvailable(port) {
	return new Promise((resolve) => {
		const server = createServer();

		server.once('error', () => {
			resolve(false);
		});

		server.once('listening', () => {
			// Immediately close - we're just testing availability
			server.close();
			resolve(true);
		});

		server.listen(port);
	});
}

/**
 * Reads the CLAUDE-HYDRA-PORT file from the repository root if it exists
 * @param repoRoot - The git repository root directory
 * @returns The port number from the file, or null if file doesn't exist or is invalid
 */
export function readPortFromFile(repoRoot) {
	try {
		const portFilePath = join(repoRoot, 'CLAUDE-HYDRA-PORT');
		if (!existsSync(portFilePath)) {
			return null;
		}

		const content = readFileSync(portFilePath, 'utf-8').trim();
		const port = parseInt(content, 10);

		// Validate port number (must leave room for port+1 for WebSocket)
		if (isNaN(port) || port < 1 || port > 65534) {
			return null;
		}

		return port;
	} catch (error) {
		// Silently return null on any file read errors
		return null;
	}
}

/**
 * Finds an available port pair (even port for HTTP, next odd port for WebSocket)
 * Starts at startPort and tests pairs: (3000, 3001), (3002, 3003), (3004, 3005), etc.
 * Uses strictPort in Vite config to ensure the port is actually used.
 */
export async function findAvailablePortPair(startPort = 3000) {
	// Ensure startPort is even
	let httpPort = startPort % 2 === 0 ? startPort : startPort + 1;

	while (httpPort < 65535) {
		const wsPort = httpPort + 1;

		// Test both ports
		const [httpAvailable, wsAvailable] = await Promise.all([
			isPortAvailable(httpPort),
			isPortAvailable(wsPort)
		]);

		if (httpAvailable && wsAvailable) {
			return { httpPort, wsPort };
		}

		// Try next pair (increment by 2 to get next even number)
		httpPort += 2;
	}

	throw new Error('No available port pair found');
}
