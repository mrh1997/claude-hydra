<script lang="ts">
	import { createEventDispatcher, getContext } from 'svelte';
	import type { FocusStack } from '$lib/FocusStack';
	import { terminals } from '$lib/stores/terminals';

	export let show = false;
	export let errorMessage = '';
	export let focusStack: FocusStack | null = null;
	export let repoPath: string; // Repository path to fetch branches from

	const websocketPort = getContext<number>('websocketPort');

	let branchName = '';
	let baseBranchName = '';
	let branches: string[] = [];
	let inputElement: HTMLInputElement;
	let baseBranchInputElement: HTMLInputElement;
	let dialogElement: HTMLDivElement;
	let dropdownElement: HTMLDivElement; // For base branch dropdown
	let branchDropdownElement: HTMLDivElement; // For branch name dropdown
	let isPushed = false; // Track whether we've pushed to focus stack
	let showDropdown = false; // For base branch dropdown
	let selectedIndex = -1; // For base branch dropdown
	let showBranchDropdown = false; // For branch name dropdown
	let selectedBranchIndex = -1; // For branch name dropdown
	const dispatch = createEventDispatcher();

	// Get list of branch names that are already opened as terminals
	$: openedBranches = $terminals.map(t => t.branchName);

	// Filter branches for the branch name dropdown
	// Exclude branches that are already opened and filter by current input
	$: filteredBranchesForInput = branches
		.filter(b => !openedBranches.includes(b))
		.filter(b => branchName === '' || b.toLowerCase().includes(branchName.toLowerCase()));

	// Filter branches for the base branch dropdown (same as before, no exclusion)
	$: filteredBranchesForBase = branches.filter(b =>
		baseBranchName === '' || b.toLowerCase().includes(baseBranchName.toLowerCase())
	);

	// Fetch branches when dialog is shown
	$: if (show && repoPath) {
		fetchBranches();
	}

	// Immediately focus input when it binds and dialog is shown
	$: if (show && inputElement) {
		inputElement.focus();
	}

	// Clear input and push/pop focus callback when dialog is shown/hidden
	$: if (show && focusStack && inputElement && !isPushed) {
		branchName = '';
		baseBranchName = '';
		errorMessage = '';
		showDropdown = false;
		selectedIndex = -1;
		showBranchDropdown = false;
		selectedBranchIndex = -1;
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
		showBranchDropdown = false;
	}

	// Fallback autofocus when focusStack is not available
	$: if (show && !focusStack && inputElement) {
		branchName = '';
		baseBranchName = '';
		errorMessage = '';
		showDropdown = false;
		selectedIndex = -1;
		showBranchDropdown = false;
		selectedBranchIndex = -1;
		setTimeout(() => {
			if (inputElement) {
				inputElement.focus();
			}
		}, 50);
	}

	function fetchBranches() {
		const ws = new WebSocket(`ws://localhost:${websocketPort}`);

		ws.onopen = () => {
			ws.send(JSON.stringify({ type: 'listBranches', repoPath }));
		};

		ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			if (data.type === 'branchesListed') {
				branches = data.branches || [];
				// Set default base branch with priority: origin/main > origin/master > main > master > first branch
				if (branches.length > 0 && !baseBranchName) {
					baseBranchName =
						branches.find(b => b === 'origin/main') ||
						branches.find(b => b === 'origin/master') ||
						branches.find(b => b === 'main') ||
						branches.find(b => b === 'master') ||
						branches[0]; // Fallback to first branch if none of the above exist
				}
			} else if (data.type === 'error') {
				console.error('Failed to list branches:', data.error);
			}
			ws.close();
		};

		ws.onerror = () => {
			console.error('WebSocket error while fetching branches');
			ws.close();
		};
	}

	function handleSubmit() {
		const trimmedBranchName = branchName.trim();
		const trimmedBaseBranch = baseBranchName.trim();
		if (!trimmedBranchName) {
			errorMessage = 'Branch name cannot be empty';
			return;
		}
		if (!trimmedBaseBranch) {
			errorMessage = 'Base branch cannot be empty';
			return;
		}
		dispatch('submit', { branchName: trimmedBranchName, baseBranchName: trimmedBaseBranch });
	}

	function handleCancel() {
		branchName = '';
		baseBranchName = '';
		errorMessage = '';
		showDropdown = false;
		dispatch('cancel');
	}

	function handleBranchNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			if (showBranchDropdown && selectedBranchIndex >= 0 && selectedBranchIndex < filteredBranchesForInput.length) {
				// Select the highlighted branch from dropdown
				event.preventDefault();
				const selectedBranch = filteredBranchesForInput[selectedBranchIndex];
				branchName = selectedBranch;
				showBranchDropdown = false;
				selectedBranchIndex = -1;
				// Fetch base branch for selected branch
				fetchBaseBranchForBranch(selectedBranch);
				return;
			}
			// Move to base branch input
			if (baseBranchInputElement) {
				baseBranchInputElement.focus();
			}
		} else if (event.key === 'Escape') {
			if (showBranchDropdown) {
				showBranchDropdown = false;
				selectedBranchIndex = -1;
			} else {
				handleCancel();
			}
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!showBranchDropdown && filteredBranchesForInput.length > 0) {
				showBranchDropdown = true;
				selectedBranchIndex = 0;
			} else if (selectedBranchIndex < filteredBranchesForInput.length - 1) {
				selectedBranchIndex++;
			}
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (selectedBranchIndex > 0) {
				selectedBranchIndex--;
			}
		}
	}

	function handleBranchNameFocus() {
		inputElement.select();
		if (filteredBranchesForInput.length > 0) {
			showBranchDropdown = true;
			selectedBranchIndex = -1;
		}
	}

	function handleBranchNameBlur() {
		// Delay hiding dropdown to allow click on dropdown item
		setTimeout(() => {
			showBranchDropdown = false;
			selectedBranchIndex = -1;
		}, 200);
	}

	function handleBranchDropdownItemClick(branch: string) {
		branchName = branch;
		showBranchDropdown = false;
		selectedBranchIndex = -1;
		// Fetch base branch for selected branch
		fetchBaseBranchForBranch(branch);
	}

	function fetchBaseBranchForBranch(branch: string) {
		const ws = new WebSocket(`ws://localhost:${websocketPort}`);

		ws.onopen = () => {
			ws.send(JSON.stringify({ type: 'getBaseBranch', repoPath, branchName: branch }));
		};

		ws.onmessage = (event) => {
			const data = JSON.parse(event.data);
			if (data.type === 'baseBranch' && data.baseBranchName) {
				// Auto-populate base branch field (but keep it editable)
				baseBranchName = data.baseBranchName;
			} else if (data.type === 'error') {
				console.error('Failed to fetch base branch:', data.error);
			}
			ws.close();
		};

		ws.onerror = () => {
			console.error('WebSocket error while fetching base branch');
			ws.close();
		};
	}

	function handleBaseBranchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			if (showDropdown && selectedIndex >= 0 && selectedIndex < filteredBranchesForBase.length) {
				// Select the highlighted item
				baseBranchName = filteredBranchesForBase[selectedIndex];
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
			if (!showDropdown && filteredBranchesForBase.length > 0) {
				showDropdown = true;
				selectedIndex = 0;
			} else if (selectedIndex < filteredBranchesForBase.length - 1) {
				selectedIndex++;
			}
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (selectedIndex > 0) {
				selectedIndex--;
			}
		}
	}

	function handleBaseBranchFocus() {
		baseBranchInputElement.select();
		if (filteredBranchesForBase.length > 0) {
			showDropdown = true;
			selectedIndex = -1;
		}
	}

	function handleBaseBranchBlur() {
		// Delay hiding dropdown to allow click on dropdown item
		setTimeout(() => {
			showDropdown = false;
			selectedIndex = -1;
		}, 200);
	}

	function handleDropdownItemClick(branch: string) {
		baseBranchName = branch;
		showDropdown = false;
		selectedIndex = -1;
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
			<h2>Create New Terminal</h2>

			<div class="form-group">
				<label for="branch-name">Branch Name:</label>
				<div class="input-container">
					<input
						id="branch-name"
						type="text"
						bind:this={inputElement}
						bind:value={branchName}
						on:keydown={handleBranchNameKeydown}
						on:focus={handleBranchNameFocus}
						on:blur={handleBranchNameBlur}
						placeholder="e.g., feature-foo"
						autocomplete="off"
					/>
					{#if showBranchDropdown && filteredBranchesForInput.length > 0}
						<div class="dropdown" bind:this={branchDropdownElement}>
							{#each filteredBranchesForInput as branch, index}
								<div
									class="dropdown-item"
									class:selected={index === selectedBranchIndex}
									on:mousedown={() => handleBranchDropdownItemClick(branch)}
									on:mouseenter={() => selectedBranchIndex = index}
									role="option"
									aria-selected={index === selectedBranchIndex}
								>
									{branch}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="form-group">
				<label for="base-branch">Derive From Branch:</label>
				<div class="input-container">
					<input
						id="base-branch"
						type="text"
						bind:this={baseBranchInputElement}
						bind:value={baseBranchName}
						on:keydown={handleBaseBranchKeydown}
						on:focus={handleBaseBranchFocus}
						on:blur={handleBaseBranchBlur}
						placeholder="Select or type branch name"
						autocomplete="off"
					/>
					{#if showDropdown && filteredBranchesForBase.length > 0}
						<div class="dropdown" bind:this={dropdownElement}>
							{#each filteredBranchesForBase as branch, index}
								<div
									class="dropdown-item"
									class:selected={index === selectedIndex}
									on:mousedown={() => handleDropdownItemClick(branch)}
									on:mouseenter={() => selectedIndex = index}
									role="option"
									aria-selected={index === selectedIndex}
								>
									{branch}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			{#if errorMessage}
				<div class="error">{errorMessage}</div>
			{/if}

			<div class="buttons">
				<button class="cancel" on:click={handleCancel}>Cancel</button>
				<button class="submit" on:click={handleSubmit}>Create</button>
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

	.form-group {
		margin-bottom: 16px;
	}

	label {
		display: block;
		margin-bottom: 6px;
		font-size: 13px;
		color: #cccccc;
		font-weight: 500;
	}

	.input-container {
		position: relative;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background-color: #2d2d2d;
		border: 1px solid #3e3e3e;
		border-top: none;
		border-radius: 0 0 3px 3px;
		max-height: 200px;
		overflow-y: auto;
		z-index: 1001;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
	}

	.dropdown-item {
		padding: 8px 12px;
		cursor: pointer;
		font-size: 14px;
		color: #cccccc;
		font-family: 'Consolas', monospace;
	}

	.dropdown-item:hover,
	.dropdown-item.selected {
		background-color: #094771;
		color: #ffffff;
	}

	.error {
		margin-top: 8px;
		padding: 8px 12px;
		background-color: #5a1d1d;
		border: 1px solid #be1100;
		border-radius: 3px;
		color: #f48771;
		font-size: 13px;
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

	.submit {
		background-color: #007acc;
		color: #ffffff;
	}

	.submit:hover {
		background-color: #005a9e;
	}
</style>
