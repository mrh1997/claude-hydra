<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';
	import { getRepoHistory, normalizePath } from '$lib/utils/repoHistory';
	import { repositories } from '$lib/stores/repositories';

	export let show = false;
	export let focusStack: FocusStack | null = null;

	let repoPath = '';
	let inputElement: HTMLInputElement;
	let dialogElement: HTMLDivElement;
	let dropdownElement: HTMLDivElement;
	let isPushed = false; // Track whether we've pushed to focus stack
	let showDropdown = false;
	let selectedIndex = -1;
	const dispatch = createEventDispatcher();

	// Get recently opened repositories, filtered to exclude currently open ones
	$: recentRepos = getRepoHistory().filter(historyPath => {
		const normalizedHistory = normalizePath(historyPath);
		return !$repositories.some(repo => normalizePath(repo.path) === normalizedHistory);
	});

	// Filter repos based on current input
	$: filteredRepos = repoPath.trim() === ''
		? recentRepos
		: recentRepos.filter(repo =>
				repo.toLowerCase().includes(repoPath.toLowerCase())
		  );

	// Clear input and push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && inputElement && !isPushed) {
		repoPath = '';
		selectedIndex = -1;
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
		showDropdown = false;
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

	function handleInputFocus() {
		if (recentRepos.length > 0) {
			showDropdown = true;
			selectedIndex = -1;
		}
	}

	function handleInputBlur(event: FocusEvent) {
		// Delay hiding dropdown to allow click on dropdown item
		setTimeout(() => {
			showDropdown = false;
			selectedIndex = -1;
		}, 200);
	}

	function handleDropdownItemClick(repo: string) {
		repoPath = repo;
		showDropdown = false;
		selectedIndex = -1;
		handleSubmit();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			if (showDropdown && selectedIndex >= 0 && selectedIndex < filteredRepos.length) {
				// Select the highlighted item
				repoPath = filteredRepos[selectedIndex];
				showDropdown = false;
				selectedIndex = -1;
			}
			handleSubmit();
		} else if (event.key === 'Escape') {
			if (showDropdown) {
				showDropdown = false;
				selectedIndex = -1;
			} else {
				handleCancel();
			}
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!showDropdown && recentRepos.length > 0) {
				showDropdown = true;
				selectedIndex = 0;
			} else if (selectedIndex < filteredRepos.length - 1) {
				selectedIndex++;
			}
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (selectedIndex > 0) {
				selectedIndex--;
			}
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
			<div class="input-container">
				<input
					type="text"
					bind:value={repoPath}
					bind:this={inputElement}
					on:keydown={handleKeydown}
					on:focus={handleInputFocus}
					on:blur={handleInputBlur}
					placeholder="Enter repository path (e.g., C:\projects\my-repo)"
					autocomplete="off"
				/>
				{#if showDropdown && filteredRepos.length > 0}
					<div class="dropdown" bind:this={dropdownElement}>
						{#each filteredRepos as repo, index}
							<div
								class="dropdown-item"
								class:selected={index === selectedIndex}
								on:mousedown={() => handleDropdownItemClick(repo)}
								on:mouseenter={() => selectedIndex = index}
							>
								{repo}
							</div>
						{/each}
					</div>
				{/if}
			</div>
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

	.input-container {
		position: relative;
		margin-bottom: 16px;
	}

	input {
		width: 100%;
		padding: 8px;
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

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: var(--input-background, #2d2d2d);
		border: 1px solid var(--focus-border, #007acc);
		border-top: none;
		border-radius: 0 0 2px 2px;
		max-height: 200px;
		overflow-y: auto;
		z-index: 1001;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
	}

	.dropdown-item {
		padding: 8px;
		cursor: pointer;
		color: var(--foreground, #cccccc);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dropdown-item:hover,
	.dropdown-item.selected {
		background: var(--focus-border, #007acc);
		color: #ffffff;
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
