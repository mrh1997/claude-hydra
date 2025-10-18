<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';

	export let originalContent: string = '';
	export let modifiedContent: string = '';
	export let fileName: string = '';
	export let language: string = 'plaintext';
	export let active: boolean = false;
	export let width: number = 350; // Width of the file tree panel
	export let commitId: string | null = null; // null = working tree, string = historical commit
	export let focusStack: FocusStack;

	const dispatch = createEventDispatcher();

	/**
	 * Detects the line ending style from file content.
	 * @param content - File content to analyze
	 * @returns 'crlf' if Windows line endings detected, 'lf' otherwise
	 */
	function detectEOL(content: string): 'lf' | 'crlf' {
		// Check first 8KB sample for performance (works even with very long first lines)
		const sample = content.substring(0, 8192);
		return sample.includes('\r\n') ? 'crlf' : 'lf';
	}

	let containerElement: HTMLDivElement;
	let diffEditor: any;
	let isDirty = false; // True when Monaco detects differences between original and modified
	let previousIsDirty = false; // Track previous isDirty state to detect transitions
	let currentOriginal = ''; // Track current original content to avoid unnecessary re-renders
	let currentModified = ''; // Track current modified content to avoid unnecessary re-renders
	let currentModels: { original: any; modified: any } | null = null; // Track current models for disposal
	let currentFileName = ''; // Track current file name to detect file changes
	let detectedEOL: 'lf' | 'crlf' = 'lf'; // Detected line ending style from original file
	let isPushed = false; // Track whether we've pushed to focus stack for current active state
	let currentChangeIndex = -1; // Track current change index for manual navigation
	let changes: any[] = []; // List of changes from Monaco

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

		// Add keyboard shortcuts to the modified editor so they work even when editing
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (modifiedEditor) {
			// F8: Next change
			modifiedEditor.addCommand(monaco.KeyCode.F8, () => {
				if (canNavigateNext()) {
					// Navigate to next change within this file
					navigateNext();
				} else {
					// At last change - dispatch event to navigate to next file
					dispatch('nextDiff');
				}
			});

			// Shift+F8: Previous change
			modifiedEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F8, () => {
				if (canNavigatePrev()) {
					// Navigate to previous change within this file
					navigatePrev();
				} else {
					// At first change - dispatch event to navigate to previous file
					dispatch('prevDiff');
				}
			});
		}

		// Set the model
		updateDiffModel();

		// Listen for diff computation updates - Monaco will properly handle LF/CRLF comparison
		diffEditor.onDidUpdateDiff(() => {
			const lineChanges = diffEditor.getLineChanges();
			// changes is null if diff not ready, empty array if files identical, array with elements if different
			if (lineChanges !== null) {
				changes = lineChanges;
				isDirty = changes.length > 0;
				currentChangeIndex = -1; // Reset change index when diff updates
			}
		});

		// Auto-save when Monaco editor loses focus (only when editable)
		if (isEditable) {
			const modifiedEditor = diffEditor.getModifiedEditor();
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
		// Reset editor's model first to avoid "TextModel got disposed before DiffEditorWidget model got reset" error
		if (diffEditor) {
			diffEditor.setModel(null);
		}
		// Then dispose models
		if (currentModels) {
			currentModels.original?.dispose();
			currentModels.modified?.dispose();
		}
		// Finally dispose editor
		if (diffEditor) {
			diffEditor.dispose();
		}
	});

	async function updateDiffModel() {
		if (!diffEditor) return;

		// Check if we're switching to a different file
		const isNewFile = fileName !== currentFileName;

		// If switching to a new file, update filename tracker
		// Don't set isDirty yet - wait until content is actually loaded
		if (isNewFile) {
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

		// Detect line ending style from modified content (working tree has actual line endings)
		// Note: originalContent comes from git blob which normalizes to LF
		detectedEOL = detectEOL(modifiedContent);

		// Store reference to old models for disposal after setting new ones
		const oldModels = currentModels;

		// Create new models
		const originalModel = monaco.editor.createModel(originalContent, language);
		const modifiedModel = monaco.editor.createModel(modifiedContent, language);

		// Set line ending sequence on modified model to match detected EOL
		const eolSequence = detectedEOL === 'crlf'
			? monaco.editor.EndOfLineSequence.CRLF
			: monaco.editor.EndOfLineSequence.LF;
		modifiedModel.setEOL(eolSequence);

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
		// Always save before closing (when viewing working tree) to ensure file on disk matches editor
		// This is important even when not dirty (e.g., user manually edited to match HEAD)
		if (commitId === null) {
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
		// Note: isDirty will update when parent refreshes and updateDiffModel() is called
		dispatch('save', { content });
	}

	function handleDiscard() {
		if (!diffEditor) return;

		// Get the original content (git HEAD state)
		const originalEditor = diffEditor.getOriginalEditor();
		const originalContent = originalEditor?.getValue() || '';

		// Set the modified editor's content to match the original
		// This triggers onDidUpdateDiff which will set isDirty = false
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (modifiedEditor) {
			modifiedEditor.setValue(originalContent);
		}

		// Discard changes using git restore (respects core.autocrlf for proper line endings)
		dispatch('discard');
	}

	/**
	 * Navigate to a specific change by index
	 */
	function navigateToChange(index: number) {
		if (!diffEditor || index < 0 || index >= changes.length) return;

		const change = changes[index];
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (!modifiedEditor) return;

		const lineNumber = change.modifiedStartLineNumber || 1;
		modifiedEditor.setPosition({ lineNumber, column: 1 });
		modifiedEditor.revealLineInCenter(lineNumber);
		currentChangeIndex = index;
	}

	/**
	 * Navigate to first change in the diff
	 */
	export function navigateToFirst() {
		if (changes.length > 0) {
			navigateToChange(0);
		}
	}

	/**
	 * Navigate to last change in the diff
	 */
	export function navigateToLast() {
		if (changes.length > 0) {
			navigateToChange(changes.length - 1);
		}
	}

	/**
	 * Navigate to next change
	 */
	export function navigateNext() {
		if (currentChangeIndex < changes.length - 1) {
			navigateToChange(currentChangeIndex + 1);
		}
	}

	/**
	 * Navigate to previous change
	 */
	export function navigatePrev() {
		if (currentChangeIndex > 0) {
			navigateToChange(currentChangeIndex - 1);
		} else if (currentChangeIndex === -1 && changes.length > 0) {
			// Not yet navigated - jump to last change
			navigateToChange(changes.length - 1);
		}
	}

	/**
	 * Check if we can navigate to next change
	 */
	export function canNavigateNext(): boolean {
		return currentChangeIndex < changes.length - 1;
	}

	/**
	 * Check if we can navigate to previous change
	 */
	export function canNavigatePrev(): boolean {
		return currentChangeIndex > 0 || (currentChangeIndex === -1 && changes.length > 0);
	}

	/**
	 * Get current cursor position for saving state
	 */
	export function getCurrentPosition() {
		if (!diffEditor) return null;
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (!modifiedEditor) return null;
		return modifiedEditor.getPosition();
	}

	/**
	 * Restore cursor position
	 */
	export function restorePosition(position: any) {
		if (!diffEditor || !position) return;
		const modifiedEditor = diffEditor.getModifiedEditor();
		if (!modifiedEditor) return;
		modifiedEditor.setPosition(position);
		modifiedEditor.revealPositionInCenter(position);
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
		// Note: F8/Shift-F8 are handled by Monaco's addCommand() in onMount
	}

	// Update diff when file or content changes
	$: if (diffEditor) {
		// Explicitly track these dependencies so Svelte triggers on changes
		fileName; originalContent; modifiedContent; language;
		updateDiffModel();
	}

	// Layout editor and focus when it becomes active
	$: if (active && diffEditor) {
		setTimeout(() => {
			diffEditor.layout();
			// Focus the modified editor (right pane) for immediate editing
			const modifiedEditor = diffEditor.getModifiedEditor();
			if (modifiedEditor) {
				modifiedEditor.focus();
			}
		}, 0);
	}

	// Push/pop focus callback when active state changes
	$: if (active && containerElement && focusStack && !isPushed) {
		// Push focus callback when diff viewer becomes active (exactly once per activation)
		focusStack.push(() => {
			// Focus the Monaco modified editor (right pane) for immediate editing
			const modifiedEditor = diffEditor?.getModifiedEditor();
			if (modifiedEditor) {
				modifiedEditor.focus();
			}
		});
		isPushed = true;
	} else if (!active && isPushed) {
		// Pop focus callback when diff viewer becomes inactive (exactly once per deactivation)
		if (focusStack && focusStack.depth > 1) {
			focusStack.pop();
		}
		isPushed = false;
	}

	// Auto-save when user starts editing (isDirty goes from false to true)
	$: if (commitId === null && diffEditor) {
		// If isDirty changed state, check if it's user starting to edit
		if (previousIsDirty !== isDirty) {
			if (!previousIsDirty && isDirty) {
				// Only auto-save when isDirty goes from false to true (user started editing)
				// Don't auto-save when isDirty goes from true to false (discard/save operations)
				handleSave();
			}
			previousIsDirty = isDirty;
		}
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
	<div bind:this={containerElement} class="diff-container" tabindex="-1"></div>
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
