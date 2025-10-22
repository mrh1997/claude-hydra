#!/usr/bin/env node

import { execSync } from 'child_process';
import http from 'http';
import https from 'https';

// Get state from command line argument
const state = process.argv[2];
if (!state || !['ready', 'running', 'close', 'waituser'].includes(state)) {
  process.exit(1);
}

// For waituser state, get additional parameters
let text, commandline;
if (state === 'waituser') {
  commandline = process.argv[3]; // First parameter: command to execute
  text = process.argv[4]; // Second parameter: optional display text
  if (!commandline) {
    process.exit(1);
  }
  // If text is not provided, use commandline as display text
  if (!text) {
    text = commandline;
  }
}

// Get git branch name
let branchName;
try {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || '.';
  branchName = execSync(`git -C "${projectDir}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim();
} catch (error) {
  process.exit(1);
}

// Get base URL from environment
const baseUrl = process.env.CLAUDE_HYDRA_BASEURL;
if (!baseUrl) {
  process.exit(1);
}

// Construct the full URL
const url = `${baseUrl}/set-state/${encodeURIComponent(branchName)}`;

// Parse URL to determine protocol
const urlObj = new URL(url);
const client = urlObj.protocol === 'https:' ? https : http;

// Prepare request options
const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

// Make the POST request
const req = client.request(url, options, (res) => {
  // Consume response data to allow socket to close
  res.on('data', () => {});
  res.on('end', () => {});
});

req.on('error', () => {});

// Set short timeout and unreference socket to allow immediate exit
req.setTimeout(100);
req.socket?.unref();

// Build request body based on state
const requestBody = { state };
if (state === 'waituser') {
  requestBody.text = text;
  requestBody.commandline = commandline;
}

req.write(JSON.stringify(requestBody));
req.end();
