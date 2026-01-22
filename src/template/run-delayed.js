#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import https from 'https';

// Get arguments: run-delayed.js "command" ["display text"]
const commandline = process.argv[2];
const text = process.argv[3] || commandline;

if (!commandline) {
	process.exit(1);
}

// Get project directory and environment variables
const projectDir = process.env.CLAUDE_PROJECT_DIR || '.';
const baseUrl = process.env.CLAUDE_HYDRA_BASEURL;
const repoHash = process.env.CLAUDE_HYDRA_REPO_HASH;

if (!baseUrl || !repoHash) {
	process.exit(1);
}

const triggerFile = join(projectDir, '.claude-hydra.start');

// Get git branch name
let branchName;
try {
	branchName = execSync(`git -C "${projectDir}" rev-parse --abbrev-ref HEAD`, {
		encoding: 'utf-8'
	}).trim();
} catch (error) {
	process.exit(1);
}

// Cleanup existing trigger file
if (existsSync(triggerFile)) {
	try {
		unlinkSync(triggerFile);
	} catch (error) {
		// Ignore cleanup errors
	}
}

// Send POST to display waituser box (fire and forget)
const apiUrl = `${baseUrl}/set-state/${encodeURIComponent(repoHash)}/${encodeURIComponent(branchName)}`;

// Parse URL to determine protocol
const urlObj = new URL(apiUrl);
const client = urlObj.protocol === 'https:' ? https : http;

// Prepare request options
const options = {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
	},
};

// Make the POST request (fire and forget)
const req = client.request(apiUrl, options, (res) => {
	// Consume response data to allow socket to close
	res.on('data', () => {});
	res.on('end', () => {});
});

req.on('error', () => {});

// Set short timeout and unreference socket to allow process to continue
req.setTimeout(100);
req.socket?.unref();

// Build request body with state: 'waituser' and text only (no commandline)
const requestBody = {
	state: 'waituser',
	text
};

req.write(JSON.stringify(requestBody));
req.end();

// Poll for trigger file
const poll = () => {
	const interval = setInterval(() => {
		if (existsSync(triggerFile)) {
			clearInterval(interval);

			// Remove trigger file
			try {
				unlinkSync(triggerFile);
			} catch (error) {
				// Ignore cleanup errors
			}

			// Execute command
			try {
				execSync(commandline, {
					cwd: projectDir,
					stdio: 'inherit'
				});
				process.exit(0);
			} catch (error) {
				process.exit(error?.status || 1);
			}
		}
	}, 200);
};

poll();
