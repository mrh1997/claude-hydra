import { createServer } from 'net';

/**
 * Tries to bind to a port and returns whether it's available
 */
async function isPortAvailable(port) {
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
