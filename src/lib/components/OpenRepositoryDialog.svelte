<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';

	export let show = false;
	export let focusStack: FocusStack | null = null;

	let repoPath = '';
	let inputElement: HTMLInputElement;
	let dialogElement: HTMLDivElement;
	let isPushed = false; // Track whether we've pushed to focus stack
	const dispatch = createEventDispatcher();

	// Clear input and push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && inputElement && !isPushed) {
		repoPath = '';
		focusStack.push(() => {
			if (inputElement) {
				inputElement.focus();
			}
		});
		isPushed = true;
	} else if (!show && isPushed && focusStack && focusStack.depth > 1) {
		// Pop when dialog closes
		focusStack.pop();
		isPushed = false;
	}

	function handleSubmit() {
		const trimmed = repoPath.trim();
		if (!trimmed) {
			return;
		}
		dispatch('submit', trimmed);
		repoPath = '';
	}

	function handleCancel() {
		repoPath = '';
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
</script>

{#if show}
	<div class="dialog-overlay">
		<div
			class="dialog"
			bind:this={dialogElement}
			on:keydown={handleDialogKeydown}
			role="dialog"
			aria-labelledby="dialog-title"
		>
			<h2 id="dialog-title">Open Repository</h2>
			<input
				type="text"
				bind:value={repoPath}
				bind:this={inputElement}
				on:keydown={handleKeydown}
				placeholder="Enter repository path (e.g., C:\projects\my-repo)"
				autocomplete="off"
			/>
			<div class="button-container">
				<button on:click={handleSubmit} disabled={!repoPath.trim()}>Open</button>
				<button on:click={handleCancel}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.dialog {
		background: var(--background, #1e1e1e);
		border: 1px solid var(--border, #3e3e3e);
		border-radius: 4px;
		padding: 20px;
		min-width: 400px;
		max-width: 600px;
	}

	h2 {
		margin: 0 0 16px 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--foreground, #cccccc);
	}

	input {
		width: 100%;
		padding: 8px;
		margin-bottom: 16px;
		background: var(--input-background, #2d2d2d);
		border: 1px solid var(--input-border, #3e3e3e);
		border-radius: 2px;
		color: var(--foreground, #cccccc);
		font-family: inherit;
		font-size: 13px;
		box-sizing: border-box;
	}

	input:focus {
		outline: none;
		border-color: var(--focus-border, #007acc);
	}

	.button-container {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	button {
		padding: 6px 14px;
		background: var(--button-background, #0e639c);
		border: none;
		border-radius: 2px;
		color: var(--button-foreground, #ffffff);
		cursor: pointer;
		font-size: 13px;
		font-family: inherit;
	}

	button:hover:not(:disabled) {
		background: var(--button-hover-background, #1177bb);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:last-child {
		background: var(--button-secondary-background, #3e3e3e);
	}

	button:last-child:hover {
		background: var(--button-secondary-hover-background, #4e4e4e);
	}
</style>
