# Inline Unlock: INSTALL

## GATE

Colin approves before this merges and before sam-ui.service restarts. Nothing has been merged, pushed or restarted. Branch `feat/inline-unlock`, worktree `/home/col/SAM_ui-unlock-wt`.

## What changed (UI only)

- New `src/components/auth/UnlockPrompt.tsx`: the message plus an Unlock button. It runs `authService.stepUp()` (the sidebar's own call), shows progress and errors, then calls the retry callback once. No retry on failure or cancel. With nothing to retry it says "Unlocked, try again."
- New `src/lib/unlockFlow.ts`: the testable logic (`runUnlock`, `classifyCallError`, `classifyUploadFailure`, `isStepUpError`).
- `authService.stepUp()` fires a `sam:auth-changed` window event on success; `LoginButton` listens and re-reads the session, so the sidebar updates after an inline unlock.
- Wired into: chat page (send, open chat, handoff, file upload), ChatList row actions, DashboardChatWidget, Terminal, operations, fleet, notifications QuestionRow, settings (device revoke).
- No change to auth server logic, WebAuthn config, step-up lifetime or any guard.
- Tests: `src/components/auth/UnlockPrompt.test.ts`.

## Merge, build, restart

```
cd /home/col/SAM_ui
git merge --no-ff feat/inline-unlock
npm run build
sudo systemctl restart sam-ui.service
```

(Use whatever `deploy.sh` normally does if that is the usual route.)

## Checks after

1. Health returns 200 (the usual /api health URL).
2. On the phone: open a chat, let the step-up lapse, trigger a handoff. The error shows an Unlock button; tap it, approve the biometric, and the handoff starts without going to the sidebar.
3. Pick a file while locked: Unlock re-uploads it.
4. The sidebar button turns green after an inline unlock.

## Rollback

```
cd /home/col/SAM_ui
git revert -m 1 <merge commit>
npm run build
sudo systemctl restart sam-ui.service
```

Or, before restart, `git merge --abort` / `git reset --hard ORIG_HEAD`. Remove the worktree with `git worktree remove /home/col/SAM_ui-unlock-wt`.
