<script lang="ts">
	import '../app.css';
	import { setContext, onMount } from 'svelte';

	export let data;

	setContext('version', data.version);
	setContext('websocketPort', data.websocketPort);
	setContext('managementPort', data.managementPort);

	// Configure Monaco Editor environment for web workers
	onMount(async () => {
		// Import worker files directly using Vite's ?worker suffix
		const editorWorker = await import('monaco-editor/esm/vs/editor/editor.worker?worker');
		const jsonWorker = await import('monaco-editor/esm/vs/language/json/json.worker?worker');
		const cssWorker = await import('monaco-editor/esm/vs/language/css/css.worker?worker');
		const htmlWorker = await import('monaco-editor/esm/vs/language/html/html.worker?worker');
		const tsWorker = await import('monaco-editor/esm/vs/language/typescript/ts.worker?worker');

		(self as any).MonacoEnvironment = {
			getWorker(_: any, label: string) {
				if (label === 'json') {
					return new jsonWorker.default();
				}
				if (label === 'css' || label === 'scss' || label === 'less') {
					return new cssWorker.default();
				}
				if (label === 'html' || label === 'handlebars' || label === 'razor') {
					return new htmlWorker.default();
				}
				if (label === 'typescript' || label === 'javascript') {
					return new tsWorker.default();
				}
				return new editorWorker.default();
			}
		};
	});
</script>

<slot />
