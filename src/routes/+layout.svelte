<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';

	export let data;

	setContext('version', data.version);
</script>

<slot />
