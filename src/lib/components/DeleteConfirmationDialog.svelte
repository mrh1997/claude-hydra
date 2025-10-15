<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let show = false;
	export let path = '';
	export let isDirectory = false;

	let confirmButton: HTMLButtonElement;
	let dialogElement: HTMLDivElement;
	const dispatch = createEventDispatcher();

	// Focus confirm button when dialog is shown
	$: if (show) {
		setTimeout(() => confirmButton?.focus(), 0);
	}

	function handleConfirm() {
		dispatch('confirm');
	}

	function handleCancel() {
		dispatch('cancel');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleCancel();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			handleConfirm();
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
	<div class="overlay" on:click={handleCancel} on:keydown={handleKeydown} role="presentation">
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleDialogKeydown} role="dialog" tabindex="-1" aria-modal="true">
			<h2>Delete {isDirectory ? 'Directory' : 'File'}</h2>
			<p>Are you sure you want to delete:</p>
			<p class="path">{path}</p>
			{#if isDirectory}
				<p class="warning">This will delete the directory and all its contents!</p>
			{/if}
			<div class="buttons">
				<button class="cancel" on:click={handleCancel}>Cancel</button>
				<button bind:this={confirmButton} class="danger" on:click={handleConfirm}>Delete</button>
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
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	h2 {
		margin: 0 0 12px 0;
		font-size: 18px;
		font-weight: 600;
		color: #cccccc;
	}

	p {
		margin: 0 0 12px 0;
		font-size: 14px;
		color: #999999;
	}

	.path {
		font-family: 'Consolas', monospace;
		color: #569cd6;
		font-weight: 600;
	}

	.warning {
		color: #f48771;
		font-weight: 600;
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

	.danger {
		background-color: #cd3131;
		color: #ffffff;
	}

	.danger:hover {
		background-color: #a02626;
	}
</style>
