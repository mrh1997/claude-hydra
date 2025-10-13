<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let show = false;

	let okButton: HTMLButtonElement;
	let dialogElement: HTMLDivElement;
	const dispatch = createEventDispatcher();

	// Focus OK button when dialog is shown
	$: if (show) {
		setTimeout(() => okButton?.focus(), 0);
	}

	function handleOk() {
		dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' || event.key === 'Enter') {
			event.preventDefault();
			handleOk();
		}
	}
</script>

{#if show}
	<div class="overlay" on:click={handleOk} on:keydown={handleKeydown} role="presentation">
		<div bind:this={dialogElement} class="dialog" on:click|stopPropagation on:keydown={handleKeydown} role="dialog" tabindex="-1" aria-modal="true">
			<h2>Rebase Conflicts Resolved</h2>
			<p>Rebase conflicts were automatically resolved by Claude. Please review and test the changes before merging.</p>
			<div class="buttons">
				<button bind:this={okButton} class="ok" on:click={handleOk}>OK</button>
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
		line-height: 1.5;
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

	.ok {
		background-color: #007acc;
		color: #ffffff;
	}

	.ok:hover {
		background-color: #005a9e;
	}
</style>
