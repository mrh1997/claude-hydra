<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let show = false;
	export let hasUncommittedChanges = false;
	export let hasUnmergedCommits = false;
	export let isExit = false;

	let primaryButton: HTMLButtonElement;
	let dialogElement: HTMLDivElement;
	const dispatch = createEventDispatcher();

	// Focus primary button when dialog is shown
	$: if (show) {
		setTimeout(() => primaryButton?.focus(), 0);
	}

	function handleCommitAndMerge() {
		dispatch('commitAndMerge');
	}

	function handleMerge() {
		dispatch('merge');
	}

	function handleDiscard() {
		dispatch('discard');
	}

	function handleCancel() {
		if (!isExit) {
			dispatch('cancel');
		}
	}

	// Computed dialog configuration
	$: dialogMessage = hasUncommittedChanges && hasUnmergedCommits
		? "This terminal has uncommitted changes and commits that haven't been merged."
		: hasUncommittedChanges
		? "This terminal has uncommitted changes."
		: "This terminal has commits that haven't been merged.";

	$: warningButtonText = hasUncommittedChanges && hasUnmergedCommits
		? "Discard local changes and merge"
		: hasUncommittedChanges
		? "Discard everything"
		: "Discard commits";

	$: primaryButtonText = hasUncommittedChanges
		? "Commit and merge"
		: "Merge";

	$: primaryButtonAction = hasUncommittedChanges
		? handleCommitAndMerge
		: handleMerge;

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !isExit) {
			handleCancel();
		} else if (event.key === 'Enter') {
			primaryButtonAction();
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
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleDialogKeydown} role="dialog" aria-modal="true">
			<h2>Close Terminal</h2>
			<p>{dialogMessage}</p>
			<div class="buttons">
				{#if !isExit}
					<button class="cancel" on:click={handleCancel}>Cancel</button>
				{/if}
				<button class="warning" on:click={handleDiscard}>{warningButtonText}</button>
				<button bind:this={primaryButton} class="primary" on:click={primaryButtonAction}>{primaryButtonText}</button>
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
		margin: 0 0 20px 0;
		font-size: 14px;
		color: #999999;
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

	.primary {
		background-color: #007acc;
		color: #ffffff;
	}

	.primary:hover {
		background-color: #005a9e;
	}

	.warning {
		background-color: #a35100;
		color: #ffffff;
	}

	.warning:hover {
		background-color: #8a4400;
	}
</style>
