---
description: Build and test the app, then commit if everything works
---

Build and run the development server, open the browser for testing, and commit changes if approved.

Here's the workflow:

1. Start the development server:
   - Run `npm run dev` in the background
   - Wait for server to be ready (about 3 seconds)
   - Open browser to http://localhost:5173

2. Ask the user: "Is everything working correctly? (yes/no)"

3. If the user responds "yes":
   - Stop the dev server
   - Run `git status` to see changes
   - Run `git diff` to see what changed
   - Add all changes with `git add .`
   - Create a commit with a descriptive message based on the changes
   - Run `/clear` to prepare for the next feature

4. If the user responds "no" or provides instructions:
   - Stop the dev server
   - Follow the user's instructions to fix the issues
   - Do NOT commit anything
