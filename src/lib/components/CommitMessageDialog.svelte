<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';

	export let show = false;
	export let focusStack: FocusStack | null = null;

	let commitMessage = '';
	let textareaElement: HTMLTextAreaElement;
	let dialogElement: HTMLDivElement;
	const dispatch = createEventDispatcher();

	// Clear input and push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && textareaElement) {
		commitMessage = '';
		focusStack.push(() => {
			if (textareaElement) {
				textareaElement.focus();
			}
		});
	} else if (!show && focusStack && focusStack.depth > 1) {
		// Pop when dialog closes
		focusStack.pop();
	}

	function handleSubmit() {
		const trimmed = commitMessage.trim();
		if (!trimmed) {
			return;
		}
		dispatch('submit', trimmed);
	}

	function handleCancel() {
		commitMessage = '';
		dispatch('cancel');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
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
	<div class="overlay" on:click={handleCancel} role="presentation">
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleDialogKeydown} role="dialog" aria-modal="true">
			<h2>Commit Message</h2>
			<p>Enter a commit message for your changes (Ctrl+Enter to submit):</p>

			<textarea
				bind:this={textareaElement}
				bind:value={commitMessage}
				on:keydown={handleKeydown}
				placeholder="e.g., Add new feature"
				rows="8"
				cols="80"
			></textarea>

			<div class="buttons">
				<button class="cancel" on:click={handleCancel}>Cancel</button>
				<button class="submit" on:click={handleSubmit} disabled={!commitMessage.trim()}>Commit</button>
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
		min-width: 700px;
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

	textarea {
		width: 100%;
		padding: 8px 12px;
		background-color: #1e1e1e;
		border: 1px solid #3e3e3e;
		border-radius: 3px;
		color: #cccccc;
		font-size: 14px;
		font-family: 'Consolas', monospace;
		box-sizing: border-box;
		resize: vertical;
		min-height: 8em;
	}

	textarea:focus {
		outline: none;
		border-color: #007acc;
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

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

	.submit:hover:not(:disabled) {
		background-color: #005a9e;
	}
</style>
