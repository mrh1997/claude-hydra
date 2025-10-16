<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let show = false;
	export let fileName = '';

	let saveButton: HTMLButtonElement;
	let dialogElement: HTMLDivElement;
	const dispatch = createEventDispatcher();

	// Focus save button when dialog is shown
	$: if (show) {
		setTimeout(() => saveButton?.focus(), 0);
	}

	function handleSave() {
		dispatch('save');
	}

	function handleDiscard() {
		dispatch('discard');
	}

	function handleCancel() {
		dispatch('cancel');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleCancel();
		}
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab' && dialogElement) {
			const focusableElements = dialogElement.querySelectorAll<HTMLElement>(
				'button:not([disabled])'
			);
			const focusableArray = Array.from(focusableElements);

			if (focusableArray.length === 0) return;

			const firstElement = focusableArray[0];
			const lastElement = focusableArray[focusableArray.length - 1];

			if (event.shiftKey) {
				if (document.activeElement === firstElement) {
					event.preventDefault();
					lastElement.focus();
				}
			} else {
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
			<h2>Unsaved Changes</h2>
			<p>Do you want to save the changes you made to {fileName}?</p>
			<p class="hint">Your changes will be lost if you don't save them.</p>
			<div class="buttons">
				<button class="cancel" on:click={handleCancel}>Cancel</button>
				<button class="discard" on:click={handleDiscard}>Don't Save</button>
				<button bind:this={saveButton} class="save" on:click={handleSave}>Save</button>
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
		z-index: 1001;
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
		color: #cccccc;
	}

	.hint {
		font-size: 13px;
		color: #999999;
		margin-bottom: 20px;
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

	.cancel {
		background-color: #3e3e3e;
		color: #cccccc;
	}

	.cancel:hover {
		background-color: #4e4e4e;
	}

	.discard {
		background-color: #5a5a5a;
		color: #cccccc;
	}

	.discard:hover {
		background-color: #6a6a6a;
	}

	.save {
		background-color: #0e639c;
		color: #ffffff;
	}

	.save:hover {
		background-color: #1177bb;
	}
</style>
