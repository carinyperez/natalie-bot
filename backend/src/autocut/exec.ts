import { execFile } from 'node:child_process';

export type ExecResult = { stdout: string; stderr: string };

/** A child process that exited non-zero (or could not start). Keeps the end of stderr for the logs. */
export class ExecError extends Error {
  readonly exitCode: number | string | null;
  readonly stderr: string;

  constructor(command: string, exitCode: number | string | null, stderr: string, cause: unknown) {
    const tail = stderr.trim().split('\n').slice(-10).join('\n');
    super(`${command} failed (exit ${exitCode}): ${tail || String(cause)}`, { cause });
    this.name = 'ExecError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Runs a binary with an argument array: no shell, so paths with spaces or quotes are passed through untouched.
 */
export function execBinary(file: string, args: string[], options: { cwd?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException & { code?: number | string }).code ?? null;
          reject(new ExecError(file.split(/[\\/]/).pop() ?? file, code, stderr, error));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
