<script lang="ts">
	import { terminals } from '$lib/stores/terminals';
	import { v4 as uuidv4 } from 'uuid';

	export let onNewTab: (id: string) => void = () => {};

	function createNewTab() {
		const id = uuidv4();
		terminals.addTab(id, 'Terminal');
		onNewTab(id);
	}

	function closeTab(id: string, event: MouseEvent) {
		event.stopPropagation();
		terminals.removeTab(id);
	}

	function selectTab(id: string) {
		terminals.setActiveTab(id);
	}
</script>

<div class="tabs-container">
	<div class="tabs">
		{#each $terminals as tab (tab.id)}
			<div
				class="tab"
				class:active={tab.active}
				on:click={() => selectTab(tab.id)}
				role="tab"
				tabindex="0"
				on:keydown={(e) => e.key === 'Enter' && selectTab(tab.id)}
			>
				<span class="tab-title">{tab.title}</span>
				<button
					class="close-btn"
					on:click={(e) => closeTab(tab.id, e)}
					aria-label="Close tab"
				>
					×
				</button>
			</div>
		{/each}
		<button class="new-tab-btn" on:click={createNewTab} aria-label="New terminal">
			+
		</button>
	</div>
</div>

<style>
	.tabs-container {
		background-color: #2d2d2d;
		border-bottom: 1px solid #1e1e1e;
		display: flex;
		align-items: center;
		height: 40px;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.tabs {
		display: flex;
		gap: 2px;
		padding: 0 8px;
		height: 100%;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		background-color: #252525;
		border: none;
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color 0.2s;
		min-width: 120px;
		max-width: 200px;
	}

	.tab:hover {
		background-color: #2d2d2d;
	}

	.tab.active {
		background-color: #1e1e1e;
		border-bottom: 2px solid #007acc;
	}

	.tab-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #cccccc;
		font-size: 13px;
	}

	.close-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 20px;
		line-height: 1;
		padding: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		transition: background-color 0.2s;
	}

	.close-btn:hover {
		background-color: #3e3e3e;
	}

	.new-tab-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 20px;
		padding: 0 12px;
		height: 100%;
		transition: background-color 0.2s;
	}

	.new-tab-btn:hover {
		background-color: #2d2d2d;
	}
</style>
