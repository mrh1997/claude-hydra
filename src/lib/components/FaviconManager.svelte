<script lang="ts">
	import { onMount } from 'svelte';
	import { terminals, type TerminalTab } from '$lib/stores/terminals';
	import { updateFavicon, type FaviconState } from '$lib/utils/favicon';
	import { playSingleBeep, playDoubleBeep } from '$lib/utils/sound';

	let previousState: FaviconState | null = null;

	/**
	 * Calculate the aggregate state from all terminal tabs
	 */
	function calculateState(tabs: TerminalTab[]): FaviconState {
		if (tabs.length === 0) {
			return 'all-ready'; // Default to ready when no tabs
		}

		const runningCount = tabs.filter(tab => tab.state === 'running').length;
		const readyCount = tabs.filter(tab => tab.state === 'ready').length;

		if (runningCount === tabs.length) {
			return 'all-running';
		} else if (readyCount === tabs.length) {
			return 'all-ready';
		} else {
			return 'mixed';
		}
	}

	/**
	 * Handle state transitions and play appropriate sounds
	 */
	async function handleStateTransition(oldState: FaviconState | null, newState: FaviconState) {
		// Play sound notifications based on transitions
		if (oldState === 'all-running' && newState === 'mixed') {
			// One beep: all tabs were running and now at least one is ready
			await playSingleBeep();
		} else if (oldState !== 'all-ready' && newState === 'all-ready' && oldState !== null) {
			// Two beeps: transition to all ready (but not on initial load)
			await playDoubleBeep();
		}
	}

	onMount(() => {
		// Set initial favicon
		const initialState = calculateState($terminals);
		updateFavicon(initialState);
		previousState = initialState;

		// Subscribe to terminals store and update favicon on changes
		const unsubscribe = terminals.subscribe((tabs) => {
			const currentState = calculateState(tabs);

			// Update favicon
			updateFavicon(currentState);

			// Handle sound notifications
			if (previousState !== null && previousState !== currentState) {
				handleStateTransition(previousState, currentState);
			}

			previousState = currentState;
		});

		return () => {
			unsubscribe();
		};
	});
</script>

<!-- This component doesn't render anything visible -->
