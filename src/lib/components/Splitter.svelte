<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let currentWidth: number;

	const dispatch = createEventDispatcher<{ resize: number }>();

	let isDragging = false;
	let startX = 0;
	let startWidth = 0;

	function handleMouseDown(event: MouseEvent) {
		isDragging = true;
		startX = event.clientX;
		startWidth = currentWidth;

		// Prevent text selection during drag
		event.preventDefault();

		// Add global listeners
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isDragging) return;

		// Calculate how much the mouse moved
		const deltaX = event.clientX - startX;

		// The new width: dragging left (negative deltaX) increases width, dragging right decreases it
		const newWidth = startWidth - deltaX;

		dispatch('resize', newWidth);
	}

	function handleMouseUp() {
		isDragging = false;
		document.removeEventListener('mousemove', handleMouseMove);
		document.removeEventListener('mouseup', handleMouseUp);
	}
</script>

<div
	class="splitter"
	class:dragging={isDragging}
	on:mousedown={handleMouseDown}
	role="separator"
	aria-orientation="vertical"
	tabindex="0"
/>

<style>
	.splitter {
		width: 4px;
		background-color: #333333;
		cursor: col-resize;
		flex-shrink: 0;
		position: relative;
		transition: background-color 0.2s;
	}

	.splitter:hover,
	.splitter.dragging {
		background-color: #007acc;
	}

	.splitter:focus {
		outline: 1px solid #007acc;
		outline-offset: -1px;
	}

	/* Prevent text selection during drag */
	.splitter.dragging {
		user-select: none;
	}

	:global(body.dragging) {
		user-select: none;
		cursor: col-resize !important;
	}
</style>
