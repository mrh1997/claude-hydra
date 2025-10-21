<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';

	export let show = false;
	export let parentPath = ''; // Empty string means root directory
	export let errorMessage = '';
	export let focusStack: FocusStack | null = null;

	let fileName = '';
	let isDirectory = false;
	let inputElement: HTMLInputElement;
	let dialogElement: HTMLDivElement;
	let isPushed = false; // Track whether we've pushed to focus stack for current show state
	const dispatch = createEventDispatcher();

	// Clear input and focus when dialog is shown
	$: if (show) {
		fileName = '';
		isDirectory = false;
		errorMessage = '';
		setTimeout(() => inputElement?.focus(), 50);
	}

	function handleSubmit() {
		const trimmed = fileName.trim();
		if (!trimmed) {
			errorMessage = 'Filename cannot be empty';
			return;
		}

		// Basic validation for invalid characters
		const invalidChars = /[<>:"|?*\x00-\x1F]/;
		if (invalidChars.test(trimmed)) {
			errorMessage = 'Filename contains invalid characters';
			return;
		}

		// Prevent path traversal
		if (trimmed.includes('..') || trimmed.includes('\\')) {
			errorMessage = 'Filename cannot contain ".." or "\\"';
			return;
		}

		dispatch('submit', { fileName: trimmed, isDirectory });
	}

	function handleCancel() {
		fileName = '';
		errorMessage = '';
		dispatch('cancel');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSubmit();
		} else if (event.key === 'Escape') {
			handleCancel();
		}
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab' && dialogElement) {
			const focusableElements = dialogElement.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled])'
			);
			const focusableArray = Array.from(focusableElements);

			if (focusableArray.length === 0) return;

			const firstElement = focusableArray[0];
			const lastElement = focusableArray[focusableArray.length - 1];

			if (event.shiftKey) {
				// Shift+Tab: If on first element, wrap to last
				if (document.activeElement === firstElement) {
					event.preventDefault();
					lastElement.focus();
				}
			} else {
				// Tab: If on last element, wrap to first
				if (document.activeElement === lastElement) {
					event.preventDefault();
					firstElement.focus();
				}
			}
		}
	}

	$: displayPath = parentPath ? `${parentPath}/` : '';

	// Push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && inputElement && !isPushed) {
		// Push focus callback when dialog is shown (exactly once per show)
		focusStack.push(() => {
			if (inputElement) {
				inputElement.focus();
			}
		});
		isPushed = true;
	} else if (!show && isPushed) {
		// Pop focus callback when dialog closes (exactly once per hide)
		if (focusStack && focusStack.depth > 1) {
			focusStack.pop();
		}
		isPushed = false;
	}
</script>

{#if show}
	<div class="overlay" on:click={handleCancel} role="presentation">
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleDialogKeydown} role="dialog" aria-modal="true">
			<h2>Create New {isDirectory ? 'Directory' : 'File'}</h2>
			<p>Enter a name for the new {isDirectory ? 'directory' : 'file'}:</p>

			{#if displayPath}
				<p class="parent-path">Location: {displayPath}</p>
			{/if}

			<input
				type="text"
				bind:this={inputElement}
				bind:value={fileName}
				on:keydown={handleKeydown}
				placeholder={isDirectory ? 'e.g., new-folder' : 'e.g., new-file.txt'}
			/>

			<label class="checkbox-label">
				<input type="checkbox" bind:checked={isDirectory} />
				<span>Create as directory</span>
			</label>

			{#if errorMessage}
				<div class="error">{errorMessage}</div>
			{/if}

			<div class="buttons">
				<button class="cancel" on:click={handleCancel}>Cancel</button>
				<button class="submit" on:click={handleSubmit}>Create</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.dialog {
		background-color: #2d2d2d;
		border: 1px solid #3e3e3e;
		border-radius: 4px;
		padding: 24px;
		min-width: 400px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	h2 {
		margin: 0 0 12px 0;
		font-size: 18px;
		font-weight: 600;
		color: #cccccc;
	}

	p {
		margin: 0 0 16px 0;
		font-size: 14px;
		color: #999999;
	}

	.parent-path {
		font-family: 'Consolas', monospace;
		color: #569cd6;
		margin-bottom: 12px;
	}

	input[type="text"] {
		width: 100%;
		padding: 8px 12px;
		background-color: #1e1e1e;
		border: 1px solid #3e3e3e;
		border-radius: 3px;
		color: #cccccc;
		font-size: 14px;
		font-family: 'Consolas', monospace;
		box-sizing: border-box;
	}

	input[type="text"]:focus {
		outline: none;
		border-color: #007acc;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		margin-top: 12px;
		cursor: pointer;
		color: #cccccc;
		font-size: 14px;
	}

	input[type="checkbox"] {
		margin-right: 8px;
		cursor: pointer;
	}

	.error {
		margin-top: 8px;
		padding: 8px 12px;
		background-color: #5a1d1d;
		border: 1px solid #be1100;
		border-radius: 3px;
		color: #f48771;
		font-size: 13px;
	}

	.buttons {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 20px;
	}

	button {
		padding: 8px 16px;
		border: none;
		border-radius: 3px;
		font-size: 14px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.cancel {
		background-color: #3e3e3e;
		color: #cccccc;
	}

	.cancel:hover {
		background-color: #4e4e4e;
	}

	.submit {
		background-color: #007acc;
		color: #ffffff;
	}

	.submit:hover {
		background-color: #005a9e;
	}
</style>
