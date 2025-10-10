import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		{
			name: 'reload-on-devversion-change',
			handleHotUpdate({ file, server }) {
				if (file.endsWith('.claude-hydra.devversion')) {
					server.ws.send({ type: 'full-reload' });
					return [];
				}
			}
		}
	],
	server: {}
});
