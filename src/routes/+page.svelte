<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import Terminal from '$lib/components/Terminal.svelte';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import PortInUseError from '$lib/components/PortInUseError.svelte';
	import FaviconManager from '$lib/components/FaviconManager.svelte';
	import { terminals } from '$lib/stores/terminals';
	import { repositories } from '$lib/stores/repositories';
	import { getOpenRepositories } from '$lib/utils/repoHistory';
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

	async function restoreOpenRepositories() {
		// First check if CLI repositories were passed
		const cliRepos = await getCliRepositories();

		if (cliRepos.length > 0) {
			console.log(`Opening ${cliRepos.length} repositories from command line:`, cliRepos);

			// Enable CLI mode to prevent localStorage persistence
			repositories.setCliMode(true);

			// Open CLI repositories
			for (const repoPath of cliRepos) {
				if (terminalTabs) {
					terminalTabs.openRepository(repoPath);
				}
			}
			return;
		}

		// No CLI repos - load previously open repositories from localStorage
		const openRepos = getOpenRepositories();

		if (openRepos.length === 0) {
			console.log('No repositories to restore');
			return;
		}

		console.log(`Restoring ${openRepos.length} repositories:`, openRepos);

		// Restore each repository in order
		for (const repoPath of openRepos) {
			if (terminalTabs) {
				terminalTabs.openRepository(repoPath);
			}
		}
	}

	async function getCliRepositories(): Promise<string[]> {
		return new Promise((resolve) => {
			if (!managementWs || managementWs.readyState !== WebSocket.OPEN) {
				resolve([]);
				return;
			}

			// Set up one-time message handler
			const messageHandler = (event: MessageEvent) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'cliRepositories') {
						managementWs?.removeEventListener('message', messageHandler);
						resolve(data.repositories || []);
					}
				} catch (error) {
					console.error('Error parsing CLI repositories response:', error);
					resolve([]);
				}
			};

			managementWs.addEventListener('message', messageHandler);

			// Request CLI repositories
			managementWs.send(JSON.stringify({ type: 'getCliRepositories' }));

			// Timeout after 1 second
			setTimeout(() => {
				managementWs?.removeEventListener('message', messageHandler);
				resolve([]);
			}, 1000);
		});
	}

	// Helper: Get terminals sorted by repository order, alphabetically within each repo
	function getSortedTerminals() {
		return $repositories.flatMap(repo =>
			$terminals.filter(t => t.repoPath === repo.path)
				.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
		);
	}

	// Helper: Scroll a tab into view
	function scrollTabIntoView(tabId: string) {
		setTimeout(() => {
			const tabElement = document.querySelector(`[data-tab-id="${tabId}"]`);
			if (tabElement) {
				tabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		}, 0);
	}

	// Helper: Navigate to previous/next tab
	function navigateTab(direction: 'forward' | 'backward', filterReady: boolean) {
		const sortedTerminals = getSortedTerminals();
		const currentIndex = sortedTerminals.findIndex(t => t.active);

		if (currentIndex === -1 || sortedTerminals.length === 0) return;

		// Build search order based on direction
		let searchOrder;
		if (direction === 'forward') {
			// Search forward from current + 1, then wrap around to beginning
			searchOrder = [
				...sortedTerminals.slice(currentIndex + 1),
				...sortedTerminals.slice(0, currentIndex)
			];
		} else {
			// Search backward from current - 1, then wrap around to end
			searchOrder = [
				...sortedTerminals.slice(0, currentIndex).reverse(),
				...sortedTerminals.slice(currentIndex + 1).reverse()
			];
		}

		// Find target tab (filter by ready state if requested)
		const targetTab = filterReady
			? searchOrder.find(tab => tab.state === 'ready')
			: searchOrder[0];

		if (targetTab) {
			terminals.setActiveTab(targetTab.id);
			scrollTabIntoView(targetTab.id);
		}
	}

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

			// Auto-restore previously open repositories on startup
			restoreOpenRepositories();
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
				navigateTab('forward', true);
				return;
			}

			// Alt-Up: Go to previous tab (ignoring state)
			if (matchesShortcut(event, SHORTCUTS.PREV_TAB)) {
				event.preventDefault();
				navigateTab('backward', false);
				return;
			}

			// Alt-Down: Go to next tab (ignoring state)
			if (matchesShortcut(event, SHORTCUTS.NEXT_TAB_SIMPLE)) {
				event.preventDefault();
				navigateTab('forward', false);
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

			// Alt-Shift-C: Create new tab in background
			if (matchesShortcut(event, SHORTCUTS.NEW_TAB_BACKGROUND)) {
				event.preventDefault();
				if (terminalTabs) {
					terminalTabs.handleNewTabClickBackground();
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

			// Alt-O: Open repository
			if (matchesShortcut(event, SHORTCUTS.OPEN_REPOSITORY)) {
				event.preventDefault();
				if (terminalTabs) {
					terminalTabs.handleOpenRepository();
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

			// F9: Execute waituser command
			if (matchesShortcut(event, SHORTCUTS.EXECUTE_WAITUSER)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab) {
					const terminalComponent = terminalComponents[activeTab.id];
					if (terminalComponent && terminalComponent.handleWaituserExecute) {
						terminalComponent.handleWaituserExecute();
					}
				}
				return;
			}

			// F10: Toggle iframe view
			if (matchesShortcut(event, SHORTCUTS.TOGGLE_IFRAME)) {
				event.preventDefault();
				const activeTab = $terminals.find(t => t.active);
				if (activeTab) {
					const terminalComponent = terminalComponents[activeTab.id];
					if (terminalComponent && terminalComponent.handleIframeToggle) {
						terminalComponent.handleIframeToggle();
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

	function handleRequestClose(event: CustomEvent<{ terminalId: string }>) {
		// Close the tab directly without dialog since backend already checked git status
		terminals.removeTab(event.detail.terminalId, false);
	}

	async function handleDiscardAndClose(event: CustomEvent<{ terminalId: string }>) {
		// Discard everything and close the tab
		// Set discard flag on the tab so Terminal.svelte's onDestroy can handle it
		terminals.update(tabs => {
			const tab = tabs.find(t => t.id === event.detail.terminalId);
			if (tab) {
				tab.discardOnDestroy = true;
			}
			return tabs;
		});

		// Remove tab - Terminal.svelte's onDestroy will send discard/reset/destroy messages
		terminals.removeTab(event.detail.terminalId, false);
	}

	async function handleKeepBranchAndClose(event: CustomEvent<{ terminalId: string }>) {
		// Keep branch and close the tab
		// Set keepBranch flag on the tab so Terminal.svelte's onDestroy can read it
		terminals.update(tabs => {
			const tab = tabs.find(t => t.id === event.detail.terminalId);
			if (tab) {
				tab.keepBranchOnDestroy = true;
			}
			return tabs;
		});

		// Remove tab - Terminal.svelte's onDestroy will send destroy message with keepBranch flag
		terminals.removeTab(event.detail.terminalId, false);
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
						derivedFromBranch={tab.derivedFromBranch}
						on:exit={handleTerminalExit}
						on:requestClose={handleRequestClose}
						on:discardAndClose={handleDiscardAndClose}
						on:keepBranchAndClose={handleKeepBranchAndClose}
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
