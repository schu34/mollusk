# mollusk: Phased Implementation Plan

## Context

Building a headless coding agent orchestrator. GitHub is the UI — users @mention a bot account in issues/PR comments, the bot queues a job, runs Claude Code CLI, and creates/updates PRs. The tech stack is TypeScript + Probot + BullMQ + Redis.

## Current State

A working Probot app already exists with:
- `src/index.ts` — handles `issues.opened` and posts a comment ("Thanks for opening this issue!")
- Build pipeline (`npm run build` compiles TS → `lib/`, `npm start` runs via probot)
- Test infrastructure (vitest, nock-based test for the issues.opened handler)
- GitHub App manifest (`app.yml`) with issues:write and metadata:read permissions
- `.env` configured with APP_ID, WEBHOOK_SECRET, etc.

## Target Structure

```
mollusk/
├── package.json
├── tsconfig.json
├── .env.example
├── CLAUDE.md
├── devplan.md
├── src/
│   ├── index.ts                # Probot app entry, event registration, worker startup
│   ├── config.ts               # Env var loading and validation
│   ├── events/
│   │   ├── parse.ts            # Mention detection, prompt extraction from webhooks
│   │   └── handlers.ts         # Event handlers that acknowledge + enqueue jobs
│   ├── queue/
│   │   ├── connection.ts       # Shared IORedis connection factory
│   │   ├── queues.ts           # BullMQ Queue definitions
│   │   ├── worker.ts           # BullMQ Worker — orchestrates the full job lifecycle
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

---

## Phase 1: Webhook Handling + @Mention Detection ✅ COMPLETE

**Goal**: Expand the existing Probot app to detect @mentions in issue comments (not just issue opens) and reply with an acknowledgment. No queuing, no agent — just proving the webhook→parse→reply pipeline.

**What exists**: `src/index.ts` handles `issues.opened` and posts a comment. Build, test, and dev infrastructure are in place.

**What's needed**:
- `src/config.ts` — loads/validates env vars including `BOT_USERNAME`
- `src/events/parse.ts` — `parseMention(payload, botUsername)` → `ParsedMention | null`
- `src/events/handlers.ts` — registers `issue_comment.created` handler; parses mention, posts ack
- `src/github/comments.ts` — `postAcknowledgment()` via `octokit.issues.createComment`
- `test/fixtures/issue_comment.json` — sample payload
- `test/events/parse.test.ts` — tests mention detection, prompt extraction, null for non-mentions
- Update `app.yml` — uncomment `issue_comment` in default_events
- Update `.env.example` — add `BOT_USERNAME`

**Verify**: `npm run build` succeeds, `npm test` passes, local dev via smee.io → @mention bot in test repo → ack comment appears.

---

## Phase 2: Job Queuing with BullMQ

**Goal**: Webhook handlers enqueue jobs instead of doing work inline. Worker picks up jobs and logs them. Proves async pipeline.

**Dependencies to install**: `bullmq`, `ioredis`

**Files to create**:
- `src/queue/connection.ts` — `createRedisConnection()` from `REDIS_URL` (default `localhost:6379`)
- `src/queue/jobs.ts` — `AgentJobData` and `AgentJobResult` interfaces
- `src/queue/queues.ts` — `agentQueue` (named `"agent-jobs"`, attempts: 1, no auto-retry)
- `src/queue/worker.ts` — `startWorker()` with concurrency 1; processor just logs for now

**Files to modify**:
- `src/events/handlers.ts` — after ack, call `agentQueue.add()` with job data
- `src/index.ts` — call `startWorker()` on startup
- `.env.example` — add `REDIS_URL`

**Verify**: Redis running locally, @mention bot → ack appears immediately, worker logs show job processed.

---

## Phase 3: Git Operations + Workspace Management

**Goal**: Worker can clone a repo, create a branch, and push. No agent yet.

**Dependencies to install**: `simple-git`

**Files to create**:
- `src/git/workspace.ts` — `createWorkspace(repoName)` → temp dir path, `cleanupWorkspace(path)`
- `src/git/operations.ts` — `cloneRepo(url, path, token)`, `createBranch()`, `checkoutBranch()`, `commitAndPush()`

**Files to modify**:
- `src/queue/worker.ts` — processor now: get token → create workspace → clone → create branch → log → cleanup in `finally`
- `app.yml` — add `contents: write` permission (needed to push branches)

**Verify**: Trigger via @mention → logs show clone + branch creation, branch visible on GitHub, workspace cleaned up.

---

## Phase 4: Claude Code CLI Integration

**Goal**: Worker spawns Claude Code CLI, feeds it context, agent makes changes in the workspace.

**Files to create**:
- `src/agent/runner.ts` — `runAgent(workspacePath, prompt)` → spawns `claude --print` with cwd set to workspace, timeout via `AGENT_TIMEOUT_MS` (default 10min), captures stdout/stderr
- `src/agent/context.ts` — `buildIssueContext(octokit, repo, issueNumber)` fetches issue title/body/comments; `buildPRReviewContext()` fetches PR diff + review comments

**Files to modify**:
- `src/queue/worker.ts` — after clone+branch: build context → run agent → if changes exist, commit+push

**Verify**: @mention with simple task (e.g. "add a README") → agent runs, changes committed and pushed to branch.

---

## Phase 5: PR Creation — Full Issue Flow

**Goal**: End-to-end: mention → ack → queue → clone → agent → PR → tag user.

**Files to create**:
- `src/github/pulls.ts` — `createPullRequest()` → PR URL, `requestReview()`

**Files to modify**:
- `src/github/comments.ts` — add `postCompletionComment()`, `postErrorComment()`
- `src/queue/worker.ts` — after push: create PR → request review from sender → post completion comment on issue. Wrap in try/catch, post error comment on failure. Always cleanup workspace in `finally`.
- `app.yml` — add `pull_requests: write` permission

**Verify**: Full pipeline test: @mention in issue → ack → PR created → user tagged → completion comment on issue. Test error path too.

---

## Phase 6: PR Review Feedback Loop

**Goal**: Bot responds to @mentions in PR review comments by pushing new commits to the same PR.

**Files to modify**:
- `src/events/parse.ts` — add `prBranch` and `prNumber` fields to `ParsedMention` for PR review context
- `src/events/handlers.ts` — add handler for `pull_request_review_comment.created` and `pull_request_review.submitted`
- `src/queue/worker.ts` — add `pr_review_mention` flow: checkout existing PR branch (not create new), build review context, run agent, commit+push, comment "@reviewer pushed changes"
- `app.yml` — uncomment `pull_request_review` and `pull_request_review_comment` events

**Verify**: Open a PR → submit review comment @mentioning bot → new commits pushed to PR branch → notification comment appears.

---

## Phase 7: Robustness + Observability

**Goal**: Production hardening — no new features.

- Configurable worker concurrency (`WORKER_CONCURRENCY` env)
- Job deduplication (prevent duplicate jobs for same issue/PR)
- Structured logging with pino (reuse Probot's logger)
- Periodic stale workspace cleanup (BullMQ repeatable job)
- Graceful shutdown (SIGTERM/SIGINT → `worker.close()`)
- Health check endpoint (`/healthz`)
- Config validation at startup (fail fast on missing env vars)

---

## Key Environment Variables

| Variable | Default | Required |
|----------|---------|----------|
| `APP_ID` | — | Yes |
| `PRIVATE_KEY_PATH` | — | Yes |
| `WEBHOOK_SECRET` | — | Yes |
| `BOT_USERNAME` | — | Yes |
| `REDIS_URL` | `redis://localhost:6379` | No |
| `WORKSPACE_BASE_DIR` | `./tmp` | No |
| `AGENT_TIMEOUT_MS` | `600000` | No |
| `WORKER_CONCURRENCY` | `1` | No |

## Build/Run Commands

```bash
npm run build        # Compile TS → lib/
npm start            # Run compiled via probot
npm test             # Vitest
```
