import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  private readonly worktreesBaseDir: string;

  constructor(opts?: { worktreesBaseDir?: string }) {
    if (opts?.worktreesBaseDir) {
      this.worktreesBaseDir = path.normalize(opts.worktreesBaseDir);
    } else {
      const localAppData =
        process.env.LOCALAPPDATA ||
        (process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Local')
          : path.join(os.homedir(), '.local', 'share'));
      this.worktreesBaseDir = path.join(localAppData, 'Murl', 'worktrees');
    }
  }

  getWorktreeBaseDir(): string {
    return this.worktreesBaseDir;
  }

  /**
   * Verifies that the given directory is a valid git repository.
   */
  async isValidRepo(repoPath: string): Promise<boolean> {
    try {
      const normalizedPath = path.normalize(repoPath);
      await execFileAsync('git', ['--no-pager', 'rev-parse', '--is-inside-work-tree'], {
        cwd: normalizedPath,
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Creates an isolated git worktree for a task outside the source repo.
   */
  async createWorktree(
    repoPath: string,
    taskId: string,
  ): Promise<{ worktreePath: string; branchName: string }> {
    const normalizedRepoPath = path.normalize(repoPath);
    const valid = await this.isValidRepo(normalizedRepoPath);
    if (!valid) {
      throw new Error(`Directory ${normalizedRepoPath} is not a valid Git repository.`);
    }

    const worktreePath = path.join(this.worktreesBaseDir, `task-${taskId}`);
    const branchName = `murl-task-${taskId}`;

    // Ensure the parent base directory exists
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Run the git worktree add command with --no-pager
    await execFileAsync(
      'git',
      ['--no-pager', 'worktree', 'add', worktreePath, '-b', branchName],
      { cwd: normalizedRepoPath },
    );

    return {
      worktreePath: path.normalize(worktreePath),
      branchName,
    };
  }

  /**
   * Prunes and cleans up a worktree and its branch.
   */
  async pruneWorktree(repoPath: string, worktreePath: string, branchName: string): Promise<void> {
    const normalizedRepoPath = path.normalize(repoPath);
    const normalizedWorktreePath = path.normalize(worktreePath);

    // 1. Forcefully remove the worktree
    try {
      await execFileAsync('git', ['--no-pager', 'worktree', 'remove', '--force', normalizedWorktreePath], {
        cwd: normalizedRepoPath,
      });
    } catch (err) {
      console.warn(`[WorktreeManager] Failed to run git worktree remove on ${normalizedWorktreePath}:`, err);
    }

    // 2. Delete the task branch
    try {
      await execFileAsync('git', ['--no-pager', 'branch', '-D', branchName], {
        cwd: normalizedRepoPath,
      });
    } catch (err) {
      console.warn(`[WorktreeManager] Failed to delete branch ${branchName}:`, err);
    }

    // 3. Clean up directory remnants if they persist
    try {
      if (fs.existsSync(normalizedWorktreePath)) {
        fs.rmSync(normalizedWorktreePath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[WorktreeManager] Failed to clean directory ${normalizedWorktreePath}:`, err);
    }
  }

  /**
   * Lists the active worktree paths.
   */
  async listWorktrees(repoPath: string): Promise<string[]> {
    const normalizedRepoPath = path.normalize(repoPath);
    try {
      const { stdout } = await execFileAsync('git', ['--no-pager', 'worktree', 'list', '--porcelain'], {
        cwd: normalizedRepoPath,
      });
      return stdout
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => path.normalize(line.substring(9).trim()));
    } catch (err) {
      console.error('[WorktreeManager] Failed to list worktrees:', err);
      return [];
    }
  }
}
