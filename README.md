# Claude Hydra

A web-based terminal interface that enables you to run multiple Claude Code instances in parallel through your browser. Claude Hydra is designed to solve the problem of working on multiple git branches simultaneously by integrating tightly with git worktrees.

## Key Features

- **Parallel Claude Code Sessions** - Run multiple Claude Code instances simultaneously, each working on different branches
- **Automatic Git Worktree Management** - Each terminal tab works on its own branch in isolation
- **Cross-Platform Support** - Full support for Windows (ConPTY), macOS, and Linux
- **Browser-Based UI** - Powerful keyboard shortcuts and visual diff navigation
- **Custom Claude Commands** - Built-in commands for common git workflows (commit, merge, rebase)
- **Smart Conflict Resolution** - Automatic conflict resolution during merge and rebase operations

## Use Cases

- Working on multiple features/branches simultaneously
- Comparing implementations across branches
- Code reviews with side-by-side branch comparison
- Managing complex git workflows with automated conflict resolution

---

## Getting Started

### Prerequisites

- **Node.js 18+** - Runtime environment
- **Git** - Installed and configured
- **Claude Code CLI** - Installed and available in PATH (test with `claude --version`)

### Installation

```bash
npm install -g claude-hydra
```

### Quick Start

**Open a repository:**
```bash
claude-hydra /path/to/your/repo
```

**Open multiple repositories:**
```bash
claude-hydra /path/to/repo1 /path/to/repo2
```

**Start empty (open repositories via UI):**
```bash
claude-hydra
```

The browser will automatically open showing the claude-hydra interface. The server runs on:
- **HTTP Server:** Port 3000 (or custom with `--port`)
- **WebSocket:** Port 3001 (HTTP port + 1)
- **Management:** Port 3002 (HTTP port + 2)

### Your First Session

1. **Open a repository** - Press `Alt-O` or the interface will prompt you
2. **Create a new tab** - Press `Alt-C` to create a new terminal tab
3. **Select or create a branch** - You'll be prompted to checkout/create a branch (worktree created automatically)
4. **Work in parallel** - Each tab runs Claude Code isolated to its branch
5. **Navigate changes** - Press `F8` to view diffs and navigate modifications visually
6. **Commit your work** - Use `/ch-commit` to create commits with auto-generated messages
7. **Merge when ready** - Use `/ch-merge` to merge your branch back to the base branch
8. **Close the tab** - Press `Alt-D` or use `/ch-close` when finished

---

## Core Features

### Base Branch Management

Every worktree in Claude Hydra tracks a **base branch** - the branch it was derived from. This enables powerful features like viewing only the commits made in your current session, automatic rebasing, and intelligent merging.

#### How It Works

When you create or checkout a branch, Claude Hydra:
1. Prompts you to select a base branch (defaults to `main`, `master`, or `origin/main`)
2. Stores the base branch in git config: `git config branch.<your-branch>.base <base-branch>`
3. Tracks all changes relative to this base branch
4. Shows only commits that exist in your branch but not in the base

#### Visual Indicators

**Base Branch Display:**
- Tabs show "from \<base-branch\>" as a subtitle under the tab title
- Only displayed if the base branch is not `main` or `master`

**Status Badges:**
- **Unmerged badge** (with × button) - Your branch has commits not yet merged to the base
  - Click × to reset branch to base (discards all commits)
- **Outdated badge** - Your branch is behind the base branch
  - Use `/ch-rebase` to incorporate latest changes

**Example:**
```
my-feature-branch
from origin/develop        ← Base branch subtitle
[Unmerged ×] [Outdated]   ← Status badges
```

#### Setting the Base Branch

When creating or checking out a branch, the dialog includes:
- **Branch Name:** The branch to create/checkout
- **Derive From Branch:** The base branch (auto-populated with intelligent defaults)

**Auto-detection priority:**
1. `origin/main`
2. `origin/master`
3. Local `main`
4. Local `master`
5. First available branch

For existing branches, Claude Hydra remembers the previously configured base branch.

#### Environment Variable

Every Claude Code session has access to:
```bash
$CLAUDE_HYDRA_BASE_BRANCH
```

This variable is used by:
- Built-in commands (`/ch-merge`, `/ch-rebase`)
- Auto-init scripts (`.claude-hydra.autoinit.*`)
- Custom commands in `.claude/commands/`

#### Impact on Git Operations

All git operations in Claude Hydra are **base-branch-aware**:

**Commit Log:** Shows only commits in your branch that aren't in the base
```bash
git log <base-branch>..<current-branch>
```

**Status Checks:**
- **Unmerged commits:** Commits in your branch not in base
- **Behind base:** Commits in base not in your branch

**Merging (`/ch-merge`):**
1. Rebases your branch onto the base
2. Fast-forwards the base branch to include your commits
3. Automatically resolves conflicts

**Rebasing (`/ch-rebase`):**
1. Rebases your branch onto latest base
2. Incorporates new commits from base into your branch
3. Automatically resolves conflicts

---

### File System Browser

The file browser provides a tree view of your repository files with multiple viewing modes and status indicators.

#### Filter Modes

Toggle between three viewing modes using buttons at the bottom of the file tree:

**1. Modified** (default)
- Shows only files that have been modified, added, deleted, or are untracked
- Hides unchanged and ignored files
- Most useful for reviewing changes

**2. All**
- Shows all tracked files in the repository
- Includes unchanged files
- Hides ignored files (from `.gitignore`)
- Useful for navigating the full project structure

**3. All+Ignored**
- Shows everything including ignored files
- Useful for finding configuration files or build artifacts
- Gray color indicates ignored files

#### File Status Colors

Files are color-coded by their git status:

| Color | Status | Meaning |
|-------|--------|---------|
| **Blue** | Modified | Existing file with changes |
| **Green** | Added/Untracked | New file |
| **Red** | Deleted | File removed |
| **Gray** | Ignored | File matched by `.gitignore` |
| **White** | Unchanged | No modifications (only in "All" modes) |

#### Commit List Integration

The file browser works in conjunction with the commit list:

**Current Working Tree** (top of commit list)
- Shows files with uncommitted changes
- Allows file creation and deletion
- Editable (you can modify files)

**Individual Commits** (below in list)
- Shows files modified in that specific commit
- Read-only view
- Useful for reviewing what changed in each commit

**Navigation:**
- Click any commit to see its files
- Click "\<current working tree\>" to return to uncommitted changes
- Files are shown relative to the base branch

#### File Operations

**When viewing the working tree** (not a commit):

**Create File/Directory:**
1. Hover over a directory row
2. Click the **+** button that appears
3. Enter file/directory name in the dialog
4. Check "Create as directory" if needed

**Create at Root:**
- Click "\<create file\>" at the bottom of the file list
- Creates file/directory at repository root

**Delete File/Directory:**
1. Hover over any file/directory row
2. Click the **trash** button that appears
3. Confirm deletion in the dialog
4. Directories are deleted recursively

**Navigate Files:**
- Click on a file to view its diff
- Click on a directory to expand/collapse
- Parent directories auto-expand when a file is selected

#### Smart Auto-Switching

If you create a directory in "Modified" mode, Claude Hydra automatically switches to "All" mode so you can see the empty directory you just created.

---

### Running State Display

Claude Hydra provides real-time visual and audio feedback showing whether Claude is actively processing or waiting for your input.

#### Tab State Indicators

Each tab displays a colored dot showing its current state:

**Green Dot (Ready)**
- Claude has finished processing and is waiting for input
- You can type commands or send prompts
- Static green circle

**Red Pulsing Dot (Running)**
- Claude is actively processing your request
- Working on a task, using tools, or generating a response
- Animated pulsing effect to draw attention

#### Favicon State Display

The browser tab favicon changes dynamically based on all terminal states:

| Favicon | State | Meaning |
|---------|-------|---------|
| **Green "ch"** | All Ready | All Claude instances are waiting for input |
| **Red "ch"** | All Running | All Claude instances are actively processing |
| **Split "c\|h"** | Mixed | Some instances running, some ready |

The split favicon shows:
- Left half (red "c") = at least one running
- Right half (green "h") = at least one ready

This allows you to monitor Claude Hydra's status even when the window is in the background.

#### Sound Notifications

Claude Hydra plays audio alerts when Claude finishes processing:

**Single Beep** (`finished-1.mp3`)
- Plays when the **first** Claude instance finishes (all-running → mixed)
- Indicates partial completion

**Double Beep** (`finished-2.mp3`)
- Plays when **all** Claude instances finish (mixed/running → all-ready)
- Indicates full completion

**Volume:** Sounds play at 30% volume to avoid being disruptive.

**Use Case:** Continue working on other tasks and get notified when Claude is ready for your next input.

#### How State Detection Works

Claude Hydra automatically detects state changes using **Claude Code hooks**:

**Running State Triggered By:**
- `UserPromptSubmit` - You submit a prompt
- `PreToolUse` - Claude is about to use a tool

**Ready State Triggered By:**
- `Stop` - Claude finishes processing
- `Notification` - Claude sends a notification (like tool results)

These hooks are automatically configured in `.claude/claude_code_settings.json` within each worktree, calling the `update-state.js` script that sends HTTP notifications to the Claude Hydra server.

**Environment:** The state is tracked per session and synchronized across all browser windows viewing the same Claude Hydra instance.

---

## Command Line Parameters

### Port Configuration

**`--port <number>` or `-p <number>`**

Specifies the HTTP port number. WebSocket and Management ports are automatically calculated as port+1 and port+2.

- **Valid range:** 1-65533 (to allow room for +1 and +2)
- **Default:** Auto-detect starting from 3000
- **Example:** `claude-hydra --port 5000` or `claude-hydra -p 5000`

Alternative formats:
- `--port=5000`
- `-p=5000`

### Headless Mode

**`--headless` or `-hl`**

Run the server without automatically opening a browser window.

- **Example:** `claude-hydra --headless`
- **Use case:** Running on remote servers or in CI/CD environments

### Development Mode

**`--dev`**

Forces development mode (runs Vite dev server instead of built application).

- **Example:** `npm run dev` (automatically uses this flag)
- **Auto-detected:** If `build/` directory doesn't exist

### Repository Paths

**Positional arguments:** One or more repository paths

Opens specified git repositories on startup.

- **Validation:** Each path must be a valid directory and git repository
- **Behavior:** Opens all valid repositories in the UI; shows errors for invalid paths
- **Enables CLI mode:** Prevents localStorage persistence of repository list
- **Example:** `claude-hydra /path/to/repo1 /path/to/repo2`

---

## Configuration Files

All configuration files are placed in your **repository root** (not in individual worktrees). These files are optional and customize claude-hydra's behavior for your project.

### `.claude-hydra.localfiles`

Defines files to automatically synchronize between the main repository and worktrees.

**Purpose:**
- Sync local configuration files that shouldn't be committed
- Keep development environment consistent across branches
- Share IDE settings, environment files, etc.

**Format:**
- One glob pattern per line
- Lines starting with `#` are comments
- Empty lines are ignored

**Default patterns (always synced):**
```
**/CLAUDE.local.md
**/.claude/commands/**
```

**Behavior:**
- Copied from main repo → worktree when creating branch or rebasing
- Copied from worktree → main repo when merging

**Example:**
```
# Sync environment files
.env.local
.env.development

# Sync IDE settings
.vscode/*.json
.idea/*.xml

# Sync local configuration
config/local.json
```

---

### `.claude-hydra.ignorefiles`

Defines additional patterns to exclude from git in worktrees (added to `.git/info/exclude`).

**Purpose:**
- Prevent specific files from being tracked in worktrees
- Supplement `.gitignore` without modifying it
- Handle worktree-specific temporary files

**Format:**
- One glob pattern per line
- Lines starting with `#` are comments
- Empty lines are ignored

**Default patterns (always ignored):**
```
.claude/
```

**Behavior:**
- Patterns are added to `.git/info/exclude` in each worktree
- Files matching these patterns won't appear in `git status`

**Example:**
```
# Ignore build artifacts in worktrees
dist/
build/
*.log

# Ignore IDE temp files
.vscode/.history
```

---

### `.claude-hydra.autoinit.{ps1,cmd,sh}`

Auto-initialization script that runs when creating a new worktree.

**Purpose:**
- Automatically set up new worktrees (install dependencies, configure environment, etc.)
- Ensure consistency across all branches
- Save time on repetitive setup tasks

**Priority order (Windows):**
1. `.claude-hydra.autoinit.ps1` (PowerShell)
2. `.claude-hydra.autoinit.cmd` (CMD batch)
3. `.claude-hydra.autoinit.sh` (Bash)

**Priority order (Unix/macOS):**
1. `.claude-hydra.autoinit.sh` (Bash)

**Behavior:**
- Executes automatically when worktree is created
- Shows green status bar: "Autoinitializing Working Tree..." while running
- Shows red error dialog if script fails (displays stderr output)
- User can close error dialog with × button

**Example (.claude-hydra.autoinit.cmd):**
```cmd
@echo off
echo Setting up new worktree...
npm install
copy .env.example .env
```

**Example (.claude-hydra.autoinit.sh):**
```bash
#!/bin/bash
set -e
echo "Setting up new worktree..."
npm install
cp .env.example .env
```

---

## Claude Commands

Custom commands available within Claude Code sessions. All commands are automatically injected into each worktree at `.claude/commands/`.

### `/ch-commit`

Create a commit with all uncommitted changes and an auto-generated commit message.

**Usage:**
```
/ch-commit [prompt]
```

**Parameters:**
- `prompt` (optional) - Fine-tune commit message generation (e.g., "focus on UI changes", "include bug details")

**Behavior:**
1. Runs `git diff` to analyze all changes
2. Generates meaningful commit message based on changes (optionally using prompt)
3. Stages all changes with `git add .`
4. Creates commit with standard footer:
   ```
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

**Examples:**
```
/ch-commit
/ch-commit "focus on UI improvements"
/ch-commit "insert extensive bug report details"
```

---

### `/ch-merge`

Merge current branch into base branch with automatic conflict resolution.

**Usage:**
```
/ch-merge
```

**Behavior:**
1. Checks for uncommitted changes
2. If uncommitted changes exist, calls `/ch-commit` automatically
3. Gets current branch and base branch (`$CLAUDE_HYDRA_BASE_BRANCH`)
4. Rebases current branch onto base branch
5. Auto-resolves conflicts by analyzing commits and conflicted files
6. Fast-forwards base branch:
   - **Local branch with worktree:** `git merge --ff-only` in base branch worktree
   - **Local branch without worktree:** Resets base branch to rebased current branch
   - **Remote branch:** Pushes current branch to remote under base branch name

**Use case:** Complete feature work and merge back to main/master

---

### `/ch-rebase`

Rebase current branch onto base branch to incorporate latest changes.

**Usage:**
```
/ch-rebase
```

**Behavior:**
1. Checks for uncommitted changes
2. If uncommitted changes exist, creates temporary WIP commit
3. Rebases onto base branch (`$CLAUDE_HYDRA_BASE_BRANCH`)
4. Auto-resolves conflicts intelligently
5. If WIP commit was created, runs `git reset HEAD~1` to restore uncommitted state
6. If base is remote branch (contains "/"), performs `git push --force-with-lease`

**Use case:** Update feature branch with latest changes from main

---

### `/ch-close`

Close the current Claude Hydra terminal tab.

**Usage:**
```
/ch-close [mode]
```

**Parameters:**
- No argument - Shows dialog if uncommitted changes or unmerged commits exist
- `discard` - Immediately discard all changes and close tab
- `keep-branch` - Create WIP commit if uncommitted changes exist, delete worktree but keep branch

**Examples:**
```
/ch-close                  # Shows confirmation dialog if there are changes
/ch-close discard          # Force close, discard everything
/ch-close keep-branch      # Keep branch with WIP commit, close tab
```

**Use case:** Clean up when finished with a branch

---

### `/ch-waituser`

Display a prompt to the user with a command to execute on demand.

**Usage:**
```
/ch-waituser "command" ["display text"]
```

**Parameters:**
1. `command` (required) - Command line to execute when user presses F9
2. `display text` (optional) - Text to display (defaults to showing command)

**Behavior:**
- Shows purple status bar at bottom with display text
- Displays hint: "Press F9 to start"
- User presses `F9` to execute command
- If command fails, shows error dialog with output

**Examples:**
```
/ch-waituser "npm test"
/ch-waituser "npm test" "Run all tests"
/ch-waituser "npm run build" "Build the project for production"
```

**Use case:** Set up commands for user to trigger manually (tests, builds, etc.)

---

### `/ch-open`

Open a URL or file in an iframe within the current terminal tab.

**Usage:**
```
/ch-open "url" "instructions" [hidden]
```

**Parameters:**
1. `url` (required) - URL or file path to open. If this is an URL it has to be on localhost!
2. `instructions` (required) - Instructions text displayed in blue bar
3. `hidden` (optional) - If set, iframe loads but stays hidden until toggled with F10

**Path/URL Detection Rules:**
- **URL:** Starts with `http:` or `https:` → passed through unchanged
- **Relative path:** Starts with `@` → stripped and resolved from worktree root
- **File path:** Starts with `file:` → stripped and resolved as file path
- **Auto-detect:** Otherwise, checks if file exists; if yes, treats as file; if no, treats as URL

**Examples:**
```
/ch-open "@index.html" "View homepage"
/ch-open "@src/components/Button.tsx" "Review Button component"
/ch-open "file:///C:/reports/test-results.html" "Check test results"
/ch-open "README.md" "View readme"
/ch-open "http://localhost:3000" "Test the application" hidden
```

**Behavior:**
- Shows blue bar at bottom with instructions and controls
- `F10` or clicking bar toggles iframe visibility
- **Reload button** - Refreshes iframe content
- **Open in new tab button** - Opens URL in external browser
- **× button** - Completely closes iframe

**Use case:** View documentation, test web apps, or review HTML files while coding

---

## Keyboard Shortcuts

### Tab Navigation

| Shortcut | Action |
|----------|--------|
| `Alt-X` | Next tab (wraps to first) |
| `Alt-Down` | Next tab |
| `Alt-Up` | Previous tab (wraps to last) |

### Tab Management

| Shortcut | Action |
|----------|--------|
| `Alt-C` | Create new tab in foreground |
| `Alt-Shift-C` | Create new tab in background |
| `Alt-D` | Close current tab |
| `Alt-O` | Open repository dialog |

### Diff Navigation

| Shortcut | Action |
|----------|--------|
| `ESC` | Close Diff Viewer |
| `Alt-F` | Return to diff viewer |

**Alt-F Behavior:**
- If previously viewing a diff: Reopens same file at same position
- Otherwise: Opens first modified file alphabetically

### Command Execution

| Shortcut | Action |
|----------|--------|
| `F9` | Execute waituser command (from `/ch-waituser`) |
| `F10` | Toggle iframe view (from `/ch-open`) |
| `Alt-S` | Fetch updates from remote repository |

### Terminal Operations

| Shortcut | Action |
|----------|--------|
| `Ctrl-C` | Copy selected text (if selection exists) / Send interrupt signal (if no selection) |
| `Ctrl-V` | Paste from clipboard |

---

## License

GPL-2.0 - See [LICENSE](LICENSE) file for details
