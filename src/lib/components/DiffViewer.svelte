<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';

	export let originalContent: string = '';
	export let modifiedContent: string = '';
	export let fileName: string = '';
	export let language: string = 'plaintext';
	export let active: boolean = false;
	export let width: number = 350; // Width of the file tree panel
	export let commitId: string | null = null; // null = working tree, string = historical commit

	const dispatch = createEventDispatcher();

	let containerElement: HTMLDivElement;
	let diffEditor: any;
	let isDirty = false; // Track if file has unsaved changes
	let currentOriginal = ''; // Track current original content to avoid unnecessary re-renders
	let currentModified = ''; // Track current modified content to avoid unnecessary re-renders
	let currentModels: { original: any; modified: any } | null = null; // Track current models for disposal
	let currentFileName = ''; // Track current file name to detect file changes

	onMount(async () => {
		// Dynamic import to avoid SSR issues
		const monaco = await import('monaco-editor');

		// Initialize Monaco diff editor
		// Editable only when viewing working tree (commitId === null)
		const isEditable = commitId === null;

		diffEditor = monaco.editor.createDiffEditor(containerElement, {
			theme: 'vs-dark',
			automaticLayout: true,
			readOnly: !isEditable,
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

		// Listen for content changes in the modified editor (only when editable)
		if (isEditable) {
			// Get the modified editor
			const modifiedEditor = diffEditor.getModifiedEditor();

			modifiedEditor?.onDidChangeModelContent(() => {
				isDirty = true;
			});

			// Auto-save when Monaco editor loses focus
			modifiedEditor?.onDidBlurEditorText(() => {
				if (isDirty) {
					handleSave();
				}
			});
		}

		// Auto-save when browser tab loses focus
		const handleVisibilityChange = () => {
			if (document.hidden && isDirty && isEditable) {
				handleSave();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// Handle resize
		const resizeObserver = new ResizeObserver(() => {
			diffEditor?.layout();
		});
		resizeObserver.observe(containerElement);

		// Cleanup
		return () => {
			resizeObserver.disconnect();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	onDestroy(() => {
		// Dispose models first
		if (currentModels) {
			currentModels.original?.dispose();
			currentModels.modified?.dispose();
		}
		// Then dispose editor
		if (diffEditor) {
			diffEditor.dispose();
		}
	});

	async function updateDiffModel() {
		if (!diffEditor) return;

		// Check if we're switching to a different file
		const isNewFile = fileName !== currentFileName;

		// If switching to a new file, reset dirty flag
		if (isNewFile) {
			isDirty = false;
			currentFileName = fileName;
		}

		// Skip update if content hasn't changed (prevents unnecessary re-renders on save)
		if (originalContent === currentOriginal && modifiedContent === currentModified && !isNewFile) {
			return;
		}

		// Don't update models while user is editing the SAME file - this would lose their changes
		// But DO update if it's a different file
		if (isDirty && !isNewFile) {
			return;
		}

		const monaco = await import('monaco-editor');

		// Store reference to old models for disposal after setting new ones
		const oldModels = currentModels;

		// Create new models
		const originalModel = monaco.editor.createModel(originalContent, language);
		const modifiedModel = monaco.editor.createModel(modifiedContent, language);

		// Set new models
		diffEditor.setModel({
			original: originalModel,
			modified: modifiedModel
		});

		// Store new models reference
		currentModels = { original: originalModel, modified: modifiedModel };

		// Dispose old models after setting new ones to prevent memory leaks
		if (oldModels) {
			oldModels.original?.dispose();
			oldModels.modified?.dispose();
		}

		// Update current content trackers
		currentOriginal = originalContent;
		currentModified = modifiedContent;
	}

	function handleClose() {
		// Auto-save before closing if dirty
		if (isDirty && commitId === null) {
			handleSave();
		}
		dispatch('close');
	}

	function handleSave() {
		if (!diffEditor) return;

		// Get the modified content from Monaco
		const modifiedEditor = diffEditor.getModifiedEditor();
		const content = modifiedEditor?.getValue() || '';

		// Dispatch save event with the content
		dispatch('save', { content });
		isDirty = false;
	}

	function handleDiscard() {
		if (!diffEditor) return;

		// Get the original content (git HEAD state)
		const originalEditor = diffEditor.getOriginalEditor();
		const originalContent = originalEditor?.getValue() || '';

		// Set the modified editor's content to match the original
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (modifiedEditor) {
			modifiedEditor.setValue(originalContent);
		}

		// Reset dirty flag
		isDirty = false;

		// Save the original content to disk (restores file to HEAD state)
		dispatch('save', { content: originalContent });
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClose();
		} else if (event.key === 's' && event.ctrlKey) {
			// Ctrl+S to save (only when editable and dirty)
			if (commitId === null && isDirty) {
				event.preventDefault();
				handleSave();
			}
		}
	}

	// Update diff when file or content changes
	$: if (diffEditor) {
		// Explicitly track these dependencies so Svelte triggers on changes
		fileName; originalContent; modifiedContent; language;
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
		<span class="file-name">{fileName}{isDirty ? ' *' : ''}</span>
		{#if commitId === null}
			<button class="discard-button" on:click={handleDiscard} title="Discard changes">Discard</button>
		{/if}
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

	.discard-button {
		background-color: #a84848;
		border: none;
		color: #ffffff;
		font-size: 13px;
		padding: 4px 12px;
		cursor: pointer;
		border-radius: 3px;
		transition: background-color 0.2s;
	}

	.discard-button:hover {
		background-color: #c85050;
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
