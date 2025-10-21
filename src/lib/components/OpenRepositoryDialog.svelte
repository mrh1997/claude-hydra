<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';
	import { getRepoHistory, normalizePath } from '$lib/utils/repoHistory';
	import { repositories } from '$lib/stores/repositories';

	export let show = false;
	export let focusStack: FocusStack | null = null;
	export let validateRepository: (repoPath: string) => Promise<{ valid: boolean; error?: string }>;
	export let removeFromHistory: (repoPath: string) => void;

	let repoPath = '';
	let inputElement: HTMLInputElement;
	let dialogElement: HTMLDivElement;
	let dropdownElement: HTMLDivElement;
	let isPushed = false; // Track whether we've pushed to focus stack
	let showDropdown = false;
	let selectedIndex = -1;
	let errorMessage: string | null = null;
	let isValidating = false;
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
		errorMessage = null;
		isValidating = false;
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
		errorMessage = null;
		isValidating = false;
	}

	// Fallback autofocus when focusStack is not available
	$: if (show && !focusStack && inputElement) {
		repoPath = '';
		selectedIndex = -1;
		errorMessage = null;
		isValidating = false;
		setTimeout(() => {
			if (inputElement) {
				inputElement.focus();
			}
		}, 50);
	}

	async function handleSubmit() {
		const trimmed = repoPath.trim();
		if (!trimmed || isValidating) {
			return;
		}

		// Validate the repository path
		isValidating = true;
		errorMessage = null;

		const result = await validateRepository(trimmed);

		isValidating = false;

		if (!result.valid) {
			// Show error message and keep dialog open
			errorMessage = result.error || 'Invalid repository path';
			return;
		}

		// Validation succeeded, dispatch submit event
		dispatch('submit', trimmed);
		repoPath = '';
		errorMessage = null;
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

	async function handleDropdownItemClick(repo: string) {
		repoPath = repo;
		showDropdown = false;
		selectedIndex = -1;

		// Validate the selected repository
		isValidating = true;
		errorMessage = null;

		const result = await validateRepository(repo);

		isValidating = false;

		if (!result.valid) {
			// Remove invalid path from history
			removeFromHistory(repo);
			// Show error message
			errorMessage = result.error || 'Invalid repository path';
			// Clear the input to allow user to try again
			repoPath = '';
			return;
		}

		// Validation succeeded, dispatch submit event
		dispatch('submit', repo);
		repoPath = '';
		errorMessage = null;
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
					on:input={() => errorMessage = null}
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
				{#if errorMessage}
					<div class="error-message">{errorMessage}</div>
				{/if}
			</div>
			<div class="button-container">
				<button on:click={handleSubmit} disabled={!repoPath.trim() || isValidating}>
					{#if isValidating}
						<span class="spinner"></span>
						Validating...
					{:else}
						Open
					{/if}
				</button>
				<button on:click={handleCancel} disabled={isValidating}>Cancel</button>
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

	.error-message {
		color: #f48771;
		font-size: 12px;
		margin-top: 4px;
		padding: 4px 8px;
		background-color: rgba(90, 29, 29, 0.5);
		border-left: 2px solid #be1100;
		border-radius: 2px;
	}

	.spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-right: 6px;
		vertical-align: middle;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
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
