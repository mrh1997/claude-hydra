# Wait for User

Display a prompt to the user with a command to execute on demand.

This command expects one required argument and one optional argument:
1. Command line to execute when the user presses F9 (required)
2. Text to display to the user (optional - defaults to showing the command line)

Usage: `/ch-waituser "command to execute" ["Display text"]`

Examples:
- `/ch-waituser "npm test"` - Shows "npm test" in the prompt
- `/ch-waituser "npm test" "Run all tests"` - Shows "Run all tests" in the prompt

Please call `.claude/hooks/update-state.js waituser` with the provided arguments.
