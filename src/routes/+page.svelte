<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import Terminal from '$lib/components/Terminal.svelte';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import PortInUseError from '$lib/components/PortInUseError.svelte';
	import FaviconManager from '$lib/components/FaviconManager.svelte';
	import { terminals } from '$lib/stores/terminals';
	import { SHORTCUTS, matchesShortcut } from '$lib/shortcuts';

	export let data;

	const managementPort = getContext<number>('managementPort');

	let terminalData: Map<string, string> = new Map();
	let terminalComponents: Record<string, any> = {}; // Object of terminalId -> Terminal component ref
	let terminalTabs: TerminalTabs;
	let managementWs: WebSocket | null = null;
	let portInUse = false;
	let serverShutdown = false;
	let reconnectTimeout: number | null = null;
	let isHmrReloading = false;

	// Check if we're in development mode
	const isDev = import.meta.env.DEV;

	function establishManagementConnection() {
		// Establish management connection
		managementWs = new WebSocket(`ws://localhost:${managementPort}`);

		managementWs.onopen = () => {
			console.log('Management connection established');
			// Connection accepted - server is available
			portInUse = false;

			// Clear any pending reconnect timeout since we're connected
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
				reconnectTimeout = null;
			}

			// Multi-repository: No auto-restore on startup
			// User will open repositories manually via "Open Repository..." button
		};

		managementWs.onerror = () => {
			console.log('Management connection error - checking if port in use');
		};

		managementWs.onclose = (event) => {
			// Check close code - 1008 means rejected (port in use)
			if (event.code === 1008) {
				console.log('Management connection rejected - port in use');
				portInUse = true;
			} else if (!portInUse) {
				if (isDev) {
					// In development, wait 5 seconds before shutting down to handle HMR
					console.log('[page] Management connection closed - waiting 5s before shutdown (HMR tolerance)');

					// Clear any existing reconnect timeout
					if (reconnectTimeout) {
						clearTimeout(reconnectTimeout);
					}

					// Try to reconnect after a brief delay
					reconnectTimeout = window.setTimeout(() => {
						console.log('[page] Attempting to reconnect management connection...');
						establishManagementConnection();

						// Check after another second if reconnection succeeded
						setTimeout(() => {
							if (!managementWs || managementWs.readyState !== WebSocket.OPEN) {
								console.log('[page] Reconnection failed - server shut down');
								serverShutdown = true;
								window.close();
							} else {
								console.log('[page] Reconnection successful - server still running');
							}
						}, 1000);
					}, 5000);
				} else {
					// Production: immediate shutdown
					console.log('Management connection closed - server shut down');
					serverShutdown = true;
					window.close();
				}
			}
		};
	}

	// Auto-restore discovered worktrees on mount
	onMount(() => {
		establishManagementConnection();

		// In development, detect Vite HMR full page reloads to suppress beforeunload dialog
		if (isDev && import.meta.hot) {
			import.meta.hot.on('vite:beforeFullReload', () => {
				console.log('[page] Vite full page reload detected - suppressing beforeunload dialog');
				isHmrReloading = true;
			});
		}

		// Handle keyboard shortcuts
		const handleKeyDown = (event: KeyboardEvent) => {
			// Alt-X: Switch to next ready terminal
			if (matchesShortcut(event, SHORTCUTS.NEXT_TAB)) {
				event.preventDefault();

				// Sort terminals alphabetically to match the UI display order
				const sortedTerminals = [...$terminals].sort((a, b) =>
					a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
				);

				const currentIndex = sortedTerminals.findIndex(t => t.active);
				if (currentIndex === -1 || sortedTerminals.length === 0) return;

				// Search for next ready tab, going DOWN the list (forward through sorted array)
				// If none found below, wrap around and search from top to current
				const searchOrder = [
					...sortedTerminals.slice(currentIndex + 1),
					...sortedTerminals.slice(0, currentIndex)
				];

				const nextReadyTab = searchOrder.find(tab => tab.state === 'ready');

				if (nextReadyTab) {
					terminals.setActiveTab(nextReadyTab.id);
				}
				return;
			}

			// Alt-C: Create new tab
			if (matchesShortcut(event, SHORTCUTS.NEW_TAB)) {
				event.preventDefault();
				if (terminalTabs) {
					terminalTabs.handleNewTabClick();
				}
				return;
			}

			// Alt-D: Close current active tab
			if (matchesShortcut(event, SHORTCUTS.CLOSE_TAB)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab && terminalTabs) {
					// Use the checkAndClose method which handles uncommitted changes
					terminalTabs.checkAndClose(activeTab.id, false);
				}
				return;
			}

			// F8: Jump to next diff/first modification
			if (matchesShortcut(event, SHORTCUTS.NEXT_DIFF)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab) {
					const terminalComponent = terminalComponents[activeTab.id];
					if (terminalComponent && terminalComponent.handleNextDiff) {
						terminalComponent.handleNextDiff();
					}
				}
				return;
			}

			// Shift+F8: Jump to previous diff/last modification
			if (matchesShortcut(event, SHORTCUTS.PREV_DIFF)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab) {
					const terminalComponent = terminalComponents[activeTab.id];
					if (terminalComponent && terminalComponent.handlePrevDiff) {
						terminalComponent.handlePrevDiff();
					}
				}
				return;
			}

			// Alt+F: Return to diff viewer
			if (matchesShortcut(event, SHORTCUTS.RETURN_TO_DIFF)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab) {
					const terminalComponent = terminalComponents[activeTab.id];
					if (terminalComponent && terminalComponent.handleReturnToDiff) {
						terminalComponent.handleReturnToDiff();
					}
				}
				return;
			}
		};

		// Handle window/tab close
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			// Allow closing without confirmation if server has shut down or HMR is reloading
			if (serverShutdown || isHmrReloading) {
				return;
			}

			const tabCount = $terminals.length;

			if (tabCount > 0) {
				// Prevent immediate close and show confirmation dialog
				event.preventDefault();
				// Chrome requires returnValue to be set
				event.returnValue = '';
				return '';
			} else {
				// No tabs - just close the management socket to trigger server shutdown
				if (managementWs && managementWs.readyState === WebSocket.OPEN) {
					managementWs.close();
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('beforeunload', handleBeforeUnload);

		// Cleanup
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('beforeunload', handleBeforeUnload);
			if (managementWs) {
				managementWs.close();
			}
		};
	});

	function handleNewTab(id: string, repoPath: string, branchName: string) {
		terminalData = new Map(terminalData).set(id, branchName);
	}

	function handleTerminalExit(event: CustomEvent<{ terminalId: string }>) {
		if (terminalTabs) {
			terminalTabs.handleExit(event.detail.terminalId);
		}
	}

	$: activeTerminal = $terminals.find(t => t.active);
	$: activeBranchName = activeTerminal ? (terminalData.get(activeTerminal.id) || activeTerminal.branchName) : null;
	$: pageTitle = activeBranchName ? `${activeBranchName} - Claude Hydra` : 'Claude Hydra';

</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<FaviconManager />

{#if portInUse}
	<PortInUseError />
{:else if serverShutdown}
	<div class="shutdown-message">
		<div class="shutdown-content">
			<h2>Server Stopped</h2>
			<p>The Claude Hydra server has been shut down.</p>
			<p class="hint">You can close this window/tab.</p>
		</div>
	</div>
{:else}
	<div class="app">
		<TerminalTabs bind:this={terminalTabs} onNewTab={handleNewTab} />

		<div class="terminal-area">
			{#if $terminals.length === 0}
				<div class="empty-state">
					Click 'Open Repository...' to get started
				</div>
			{:else}
				{#each $terminals as tab (tab.id)}
					{@const branchName = terminalData.get(tab.id) || tab.branchName}
					<Terminal
						bind:this={terminalComponents[tab.id]}
						terminalId={tab.id}
						active={tab.active}
						repoPath={tab.repoPath}
						{branchName}
						adoptExisting={tab.adoptExisting}
						on:exit={handleTerminalExit}
					/>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.app {
		display: flex;
		flex-direction: row;
		height: 100vh;
		width: 100vw;
		overflow: hidden;
		background-color: #1e1e1e;
	}

	.terminal-area {
		flex: 1;
		position: relative;
		overflow: hidden;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: #888888;
		font-size: 16px;
		user-select: none;
	}

	.shutdown-message {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100vw;
		height: 100vh;
		background-color: #1e1e1e;
		color: #cccccc;
	}

	.shutdown-content {
		text-align: center;
		max-width: 500px;
		padding: 40px;
	}

	.shutdown-content h2 {
		font-size: 24px;
		margin-bottom: 16px;
		color: #cccccc;
	}

	.shutdown-content p {
		font-size: 16px;
		line-height: 1.6;
		margin-bottom: 12px;
	}

	.shutdown-content .hint {
		font-size: 14px;
		color: #888888;
		margin-top: 20px;
	}
</style>
