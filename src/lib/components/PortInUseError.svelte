<div class="error-container">
	<div class="error-content">
		<div class="error-icon">⚠</div>
		<h1>Port Already In Use</h1>
		<p>This port is already in use by Claude Hydra.</p>
		<p class="hint">Only one browser tab can connect to a Claude Hydra server at a time.</p>
	</div>
</div>

<style>
	.error-container {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100vw;
		height: 100vh;
		background-color: #1e1e1e;
		color: #cccccc;
	}

	.error-content {
		text-align: center;
		max-width: 500px;
		padding: 40px;
	}

	.error-icon {
		font-size: 64px;
		margin-bottom: 20px;
		color: #f48771;
	}

	h1 {
		font-size: 24px;
		margin-bottom: 16px;
		color: #f48771;
	}

	p {
		font-size: 16px;
		line-height: 1.6;
		margin-bottom: 12px;
	}

	.hint {
		font-size: 14px;
		color: #888888;
		margin-top: 20px;
	}
</style>
