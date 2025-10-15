<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';

	export let originalContent: string = '';
	export let modifiedContent: string = '';
	export let fileName: string = '';
	export let language: string = 'plaintext';
	export let active: boolean = false;
	export let width: number = 350; // Width of the file tree panel

	const dispatch = createEventDispatcher();

	let containerElement: HTMLDivElement;
	let diffEditor: any;

	onMount(async () => {
		// Dynamic import to avoid SSR issues
		const monaco = await import('monaco-editor');

		// Initialize Monaco diff editor
		diffEditor = monaco.editor.createDiffEditor(containerElement, {
			theme: 'vs-dark',
			automaticLayout: true,
			readOnly: true,
			renderSideBySide: true,
			scrollBeyondLastLine: false,
			fontSize: 14,
			fontFamily: 'Consolas, "Courier New", monospace',
			minimap: {
				enabled: true
			}
		});

		// Set the model
		updateDiffModel();

		// Handle resize
		const resizeObserver = new ResizeObserver(() => {
			diffEditor?.layout();
		});
		resizeObserver.observe(containerElement);

		// Cleanup
		return () => {
			resizeObserver.disconnect();
		};
	});

	onDestroy(() => {
		if (diffEditor) {
			diffEditor.dispose();
		}
	});

	async function updateDiffModel() {
		if (!diffEditor) return;

		const monaco = await import('monaco-editor');

		const originalModel = monaco.editor.createModel(originalContent, language);
		const modifiedModel = monaco.editor.createModel(modifiedContent, language);

		diffEditor.setModel({
			original: originalModel,
			modified: modifiedModel
		});
	}

	function handleClose() {
		dispatch('close');
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	// Update diff when content changes
	$: if (diffEditor && (originalContent || modifiedContent)) {
		updateDiffModel();
	}

	// Layout editor when it becomes active
	$: if (active && diffEditor) {
		setTimeout(() => {
			diffEditor.layout();
		}, 0);
	}

	// Focus handling
	$: if (active && containerElement) {
		containerElement.focus();
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="diff-viewer" class:hidden={!active} style="width: calc(100% - {width + 4}px)">
	<div class="diff-header">
		<button class="close-button" on:click={handleClose} title="Close (ESC)">×</button>
		<span class="file-name">{fileName}</span>
	</div>
	<div bind:this={containerElement} class="diff-container"></div>
</div>

<style>
	.diff-viewer {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background-color: #1e1e1e;
		display: flex;
		flex-direction: column;
		z-index: 10;
	}

	.diff-viewer.hidden {
		display: none;
	}

	.diff-header {
		display: flex;
		align-items: center;
		background-color: #252525;
		border-bottom: 1px solid #333333;
		padding: 8px 12px;
		gap: 12px;
		height: 40px;
		flex-shrink: 0;
	}

	.close-button {
		background: none;
		border: none;
		color: #cccccc;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
	}

	.close-button:hover {
		background-color: #3e3e3e;
	}

	.file-name {
		color: #cccccc;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 13px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-container {
		flex: 1;
		overflow: hidden;
	}
</style>
