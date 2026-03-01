# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**mollusk** is a headless coding agent orchestrator. It has no UI — GitHub *is* the UI. The app runs on a server under a dedicated GitHub "bot" account. Users interact with it by @-mentioning the bot in GitHub issues or PR comments with a prompt. The bot then:

1. Receives the mention via GitHub webhook
2. Spins up a coding agent to work on the request
3. Creates a PR when done and tags the requesting user for review
4. Monitors PR review comments and automatically addresses feedback
5. Pushes updated commits so the user can re-review

## Architecture

### Core Flow

```
GitHub Webhook → Event Router → Agent Orchestrator → Git Operations → GitHub API (PR/comments)
```

- **Webhook listener** (Probot): Receives `issues.opened`, `issue_comment.created`, `pull_request_review_comment.created`, and `pull_request_review.submitted` events from GitHub.
- **Event router**: Parses events to determine if the bot was mentioned, extracts the prompt and context (issue body, conversation history, PR diff).
- **Agent orchestrator**: Manages coding agent sessions — spawning agents, feeding them context, collecting results.
- **Git operations**: Clones repos, creates branches, commits changes, pushes to remote.
- **GitHub API layer**: Creates PRs, posts comments, requests reviews, responds to review feedback.

### Key Behaviors

- When mentioned in an **issue** (or on issue open): clone the repo, create a branch, run the agent, open a PR, tag the mentioning user.
- When mentioned in a **PR review comment**: check out the PR branch, run the agent with review context, push new commits to the same PR, notify the reviewer.
- The bot should always reply with a brief acknowledgment comment when it picks up a task, so users know work is in progress.

## Tech Stack

- **TypeScript** (ES2022, Node16 modules, strict mode)
- **Probot** — GitHub App framework, webhook handling
- **BullMQ + Redis** — async job queuing
- **simple-git** — git operations (clone, branch, commit, push)
- **Claude Code CLI** — coding agent (`claude --print`)

## Build & Run

```bash
npm run build        # Compile TS → lib/
npm start            # Run compiled via probot
npm test             # Vitest
```

## Project Structure

```
mollusk/
├── package.json
├── tsconfig.json
├── .env.example
├── CLAUDE.md
├── src/
│   ├── index.ts                # Probot app entry, event registration
│   ├── config.ts               # Env var loading and validation
│   ├── events/
│   │   ├── parse.ts            # Mention detection, prompt extraction
│   │   └── handlers.ts         # Event handlers that acknowledge + enqueue jobs
│   ├── queue/
│   │   ├── connection.ts       # Shared IORedis connection factory
│   │   ├── queues.ts           # BullMQ Queue definitions
│   │   ├── worker.ts           # BullMQ Worker — orchestrates full job lifecycle
│   │   └── jobs.ts             # Job data/result type definitions
│   ├── agent/
│   │   ├── runner.ts           # Spawns Claude Code CLI subprocess
│   │   └── context.ts          # Builds prompt context from issue/PR data
│   ├── git/
│   │   ├── operations.ts       # Clone, branch, commit, push via simple-git
│   │   └── workspace.ts        # Temp directory create/cleanup
│   └── github/
│       ├── comments.ts         # Post acknowledgment/completion/error comments
│       └── pulls.ts            # Create PRs, request reviews
└── test/
    ├── fixtures/               # Sample webhook payloads
    └── events/
        └── parse.test.ts
```
