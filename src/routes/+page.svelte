<script lang="ts">
	import { onMount } from 'svelte';
	import Terminal from '$lib/components/Terminal.svelte';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import { terminals } from '$lib/stores/terminals';
	import { v4 as uuidv4 } from 'uuid';

	let terminalIds: string[] = [];

	onMount(() => {
		// Create initial terminal
		createInitialTerminal();
	});

	function createInitialTerminal() {
		const id = uuidv4();
		terminals.addTab(id, 'Terminal 1');
		terminalIds = [id];
	}

	function handleNewTab(id: string) {
		terminalIds = [...terminalIds, id];
	}

	// Update terminal IDs when tabs change
	$: {
		// Remove terminal IDs that no longer exist in the store
		const existingIds = $terminals.map(t => t.id);
		terminalIds = terminalIds.filter(id => existingIds.includes(id));
	}
</script>

<svelte:head>
	<title>Claude Code Terminal</title>
</svelte:head>

<div class="app">
	<div class="header">
		<h1>Claude Code Terminal</h1>
	</div>

	<TerminalTabs onNewTab={handleNewTab} />

	<div class="terminal-area">
		{#if $terminals.length === 0}
			<div class="empty-state">
				Click '+' to create a new Terminal tab
			</div>
		{:else}
			{#each terminalIds as terminalId (terminalId)}
				{@const tab = $terminals.find(t => t.id === terminalId)}
				{#if tab}
					<Terminal {terminalId} active={tab.active} />
				{/if}
			{/each}
		{/if}
	</div>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		overflow: hidden;
		background-color: #1e1e1e;
	}

	.header {
		background-color: #2d2d2d;
		padding: 8px 16px;
		border-bottom: 1px solid #1e1e1e;
	}

	.header h1 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: #cccccc;
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
</style>
