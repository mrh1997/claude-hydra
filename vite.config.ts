import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		{
			name: 'reload-on-modversion-change',
			handleHotUpdate({ file, server }) {
				if (file.endsWith('MODVERSION')) {
					server.ws.send({ type: 'full-reload' });
					return [];
				}
			}
		}
	],
	server: {
		fs: {
			allow: ['..']
		},
		watch: {
			ignored: ['**/.claude-hydra/**']
		}
	}
});
