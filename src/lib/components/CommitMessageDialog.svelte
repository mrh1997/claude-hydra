<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let show = false;

	let commitMessage = '';
	let inputElement: HTMLInputElement;
	const dispatch = createEventDispatcher();

	// Clear input and focus when dialog is shown
	$: if (show) {
		commitMessage = '';
		setTimeout(() => inputElement?.focus(), 0);
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
		if (event.key === 'Enter') {
			handleSubmit();
		} else if (event.key === 'Escape') {
			handleCancel();
		}
	}
</script>

{#if show}
	<div class="overlay" on:click={handleCancel} role="presentation">
		<div class="dialog" on:click|stopPropagation role="dialog" aria-modal="true">
			<h2>Commit Message</h2>
			<p>Enter a commit message for your changes:</p>

			<input
				type="text"
				bind:this={inputElement}
				bind:value={commitMessage}
				on:keydown={handleKeydown}
				placeholder="e.g., Add new feature"
			/>

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

	input {
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

	input:focus {
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
