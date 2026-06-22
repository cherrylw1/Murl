import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WorktreeManager } from './manager.js';

const execFileAsync = promisify(execFile);

describe('WorktreeManager', () => {
  let tempRepoPath: string;
  let worktreesBaseDir: string;
  let manager: WorktreeManager;

  beforeAll(async () => {
    // Create a temporary directory for the base Git repository
    tempRepoPath = path.join(os.tmpdir(), `murl-test-git-repo-${crypto.randomUUID()}`);
    fs.mkdirSync(tempRepoPath, { recursive: true });

    // Initialize Git repo
    await execFileAsync('git', ['init'], { cwd: tempRepoPath });
    await execFileAsync('git', ['config', 'user.name', 'Murl Test'], { cwd: tempRepoPath });
    await execFileAsync('git', ['config', 'user.email', 'test@murl.dev'], { cwd: tempRepoPath });

    // Create and commit a dummy file
    const readmePath = path.join(tempRepoPath, 'README.md');
    fs.writeFileSync(readmePath, '# Mock Repository');
    await execFileAsync('git', ['add', 'README.md'], { cwd: tempRepoPath });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: tempRepoPath });

    // Setup the worktree manager
    worktreesBaseDir = path.join(os.tmpdir(), `murl-test-worktrees-${crypto.randomUUID()}`);
    manager = new WorktreeManager({ worktreesBaseDir });
  });

  afterAll(async () => {
    // Clean up base repo
    if (fs.existsSync(tempRepoPath)) {
      try {
        fs.rmSync(tempRepoPath, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to clean up temp base repo directory:', err);
      }
    }

    // Clean up worktrees base dir
    if (fs.existsSync(worktreesBaseDir)) {
      try {
        fs.rmSync(worktreesBaseDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to clean up temp worktree base directory:', err);
      }
    }
  });

  it('correctly handles git worktree lifecycle operations', async () => {
    // 1. Verify isValidRepo
    const isValid = await manager.isValidRepo(tempRepoPath);
    expect(isValid).toBe(true);

    const isInvalid = await manager.isValidRepo(path.join(os.tmpdir(), 'non-existent-directory'));
    expect(isInvalid).toBe(false);

    // 2. Create worktree
    const taskId = crypto.randomUUID();
    const { worktreePath, branchName } = await manager.createWorktree(tempRepoPath, taskId);

    expect(worktreePath).toContain(`task-${taskId}`);
    expect(branchName).toBe(`murl-task-${taskId}`);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 3. Verify it is listed
    const activeWorktrees = await manager.listWorktrees(tempRepoPath);
    expect(activeWorktrees.some((w) => path.normalize(w) === path.normalize(worktreePath))).toBe(true);

    // 4. Prune the worktree
    await manager.pruneWorktree(tempRepoPath, worktreePath, branchName);
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Verify it is no longer listed
    const afterPruningList = await manager.listWorktrees(tempRepoPath);
    expect(afterPruningList.some((w) => path.normalize(w) === path.normalize(worktreePath))).toBe(false);

    // Verify branch is deleted
    let branchExists = true;
    try {
      await execFileAsync('git', ['--no-pager', 'rev-parse', '--verify', branchName], { cwd: tempRepoPath });
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  });
});
