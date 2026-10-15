# AI Agent Operating Protocol: The Verification Cage

All AI agents (OMP, Antigravity, Cursor, Cline, Claude Code) operating in this repository must strictly adhere to the rules outlined in this document. No exceptions.

---

## 1. Startup Contract
Before writing, modifying, or refactoring any code in this repository:
1. You **MUST** read `SPEC.md` to understand system architecture, directory contracts, and state invariants.
2. You **MUST** read this file (`AGENTS.md`) and operate strictly within your assigned domain.
3. You **MUST NOT** hallucinate APIs, fabricate mock types, introduce untyped `any`, or bypass pre-existing verification scripts.

---

## 2. The Gatekeeper Rule

> **NO TASK, FEATURE, OR BUGFIX IS COMPLETE UNTIL THE GATEKEEPER PASSES.**

Every change must pass verification before it can be merged or declared done:
```powershell
powershell -ExecutionPolicy Bypass -File .\verify.ps1
```
Or for frontend-only scopes:
```bash
npm run verify
```

The Gatekeeper enforces:
- `npm run typecheck`: TypeScript compiles with 0 errors under strict type flags (`noUnusedLocals`, `noUnusedParameters`, `strict: true`).
- `npm run lint`: Biome linter and formatter report 0 errors and 0 warnings on error rules.
- `npm run build`: Vite production bundle compiles cleanly.
- Native .NET compilation: When the .NET SDK is available, `dotnet build` with `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` must succeed.

**Strict Prohibition**: Agents are strictly forbidden from declaring completion, committing code, or asking the user to test if `verify.ps1` produces a non-zero exit code or any gate fails.

---

## 3. Tool Assignment Protocol

To avoid conflicting changes, broken abstractions, or architectural regression, responsibility is divided cleanly by tool capability:

### OMP (Host & Engine Specialist)
- **Primary Domain**:
  - Native C# host (`MainWindow.xaml.cs`, `App.xaml.cs`).
  - Interop & Win32 subsystems (`Interop/`, audio loopback, COM, SMTC).
  - Background services & telemetry (`Services/SystemMonitorService.cs`, `WallpaperService.cs`, `DiagnosticsLog.cs`).
  - IPC Contracts & bridge plumbing (`src/services/hostBridge.ts`).
  - Build automation, package scripts, WiX installer, and static verification tooling (`verify.ps1`, `scripts/`, `biome.json`, `tsconfig.json`).
- **Boundaries**: Must maintain mock fallbacks in `hostBridge.ts` so views continue running in standalone preview.

### Antigravity & Cursor (View & UX Specialists)
- **Primary Domain**:
  - React view components (`src/views/`).
  - Presentation components (`src/components/`).
  - Styling and animations (`src/index.css`, Tailwind utility classes).
  - Visual layout, responsive spacing, theme variable consumption.
- **Workflow**:
  - Run the frontend standalone via `npm run dev` in browser or web preview without needing the native WPF host.
  - Rely on mock data fallbacks provided by `hostBridge.ts`.
- **Boundaries**: Must NEVER modify native C# files or bypass TypeScript interfaces defined in `hostBridge.ts`.

---

## 4. Branch & Worktree Isolation Rule

To protect `main` from broken states, hallucinatory diffs, or half-finished agent refactors:
1. Every non-trivial feature, refactor, or experiment MUST run in an isolated Git worktree:
   ```powershell
   .\scripts\worktree.ps1 new <feature-name>
   ```
2. Develop and verify inside the worktree directory (`..\canopy-worktrees\<feature-name>`).
3. Run verification inside the worktree:
   ```powershell
   .\scripts\worktree.ps1 test
   ```
4. If the implementation succeeds and all gates pass:
   ```powershell
   .\scripts\worktree.ps1 merge <feature-name>
   ```
5. If the agent derails, hallucinates, or produces irrecoverable regressions:
   **DO NOT ATTEMPT TO REPAIR A CONTAMINATED BRANCH.**
   Tear down and abort immediately:
   ```powershell
   .\scripts\worktree.ps1 abort <feature-name>
   ```
   Start over from a clean state with a concise 3-sentence instruction prompt.
