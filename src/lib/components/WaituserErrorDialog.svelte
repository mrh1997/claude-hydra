<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';

	export let show = false;
	export let output = '';
	export let focusStack: FocusStack | null = null;

	let okButton: HTMLButtonElement;
	let dialogElement: HTMLDivElement;
	let isPushed = false; // Track whether we've pushed to focus stack
	const dispatch = createEventDispatcher();

	// Push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && okButton && !isPushed) {
		focusStack.push(() => {
			if (okButton) {
				okButton.focus();
			}
		});
		isPushed = true;
	} else if (!show && isPushed && focusStack && focusStack.depth > 1) {
		// Pop when dialog closes
		focusStack.pop();
		isPushed = false;
	}

	function handleClose() {
		dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' || event.key === 'Enter') {
			event.preventDefault();
			handleClose();
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
	<div class="overlay" on:click={handleClose} on:keydown={handleKeydown} role="presentation">
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleDialogKeydown} role="dialog" tabindex="-1" aria-modal="true">
			<h2>Command Execution Failed</h2>
			<div class="output-container">
				<pre class="output">{output}</pre>
			</div>
			<div class="buttons">
				<button bind:this={okButton} class="primary" on:click={handleClose}>OK</button>
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
		min-width: 500px;
		max-width: 800px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	h2 {
		margin: 0 0 12px 0;
		font-size: 18px;
		font-weight: 600;
		color: #f48771;
	}

	.output-container {
		margin: 0 0 20px 0;
		max-height: 400px;
		overflow-y: auto;
		background-color: #1e1e1e;
		border: 1px solid #3e3e3e;
		border-radius: 3px;
		padding: 12px;
	}

	.output {
		margin: 0;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 12px;
		color: #cccccc;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.buttons {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	button {
		padding: 8px 16px;
		border: none;
		border-radius: 3px;
		font-size: 14px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.primary {
		background-color: #0e639c;
		color: #ffffff;
	}

	.primary:hover {
		background-color: #1177bb;
	}
</style>
