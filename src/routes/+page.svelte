<script lang="ts">
	import Terminal from '$lib/components/Terminal.svelte';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import { terminals } from '$lib/stores/terminals';

	let terminalData: Map<string, string> = new Map();

	function handleNewTab(id: string, branchName: string) {
		terminalData = new Map(terminalData).set(id, branchName);
	}

	$: activeTerminal = $terminals.find(t => t.active);
	$: activeBranchName = activeTerminal ? (terminalData.get(activeTerminal.id) || activeTerminal.branchName) : null;
	$: pageTitle = activeBranchName ? `${activeBranchName} - Claude Hydra` : 'Claude Hydra';

</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<div class="app">
	<TerminalTabs onNewTab={handleNewTab} />

	<div class="terminal-area">
		{#if $terminals.length === 0}
			<div class="empty-state">
				Click '+' to create a new Terminal tab
			</div>
		{:else}
			{#each $terminals as tab (tab.id)}
				{@const branchName = terminalData.get(tab.id) || tab.branchName}
				<Terminal terminalId={tab.id} active={tab.active} {branchName} />
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
