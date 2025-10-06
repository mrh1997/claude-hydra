<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';

	export let data;

	setContext('version', data.version);
	setContext('websocketPort', data.websocketPort);
	setContext('managementPort', data.managementPort);
</script>

<slot />
