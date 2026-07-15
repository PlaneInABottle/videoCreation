import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inheritStderr?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((value) => (/^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.inheritStderr) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(
        new Error(
          `${formatCommand(command, args)} failed with exit code ${String(code)}\n${result.stderr}`,
        ),
      );
    });
  });
}

export async function requireBinary(binary: string): Promise<void> {
  await run('which', [binary]);
}
