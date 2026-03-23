import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateProjectRoot } from './validate-project-root.ts';

describe('validateProjectRoot', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'validate-root-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws when cwd is missing sentinel files', () => {
    process.chdir(tempDir);
    expect(() => validateProjectRoot()).toThrow(/not the project root/);
  });

  it('throws with details about which sentinels are missing', () => {
    process.chdir(tempDir);
    expect(() => validateProjectRoot()).toThrow(
      /daily-orbit.*pnpm-workspace\.yaml/,
    );
  });

  it('passes when all sentinel files exist', () => {
    // Create the sentinel structure
    writeFileSync(join(tempDir, 'daily-orbit'), '#!/bin/bash');
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:');
    mkdirSync(join(tempDir, 'packages', 'server'), { recursive: true });
    mkdirSync(join(tempDir, 'packages', 'web'), { recursive: true });
    writeFileSync(join(tempDir, 'packages', 'server', 'package.json'), '{}');
    writeFileSync(join(tempDir, 'packages', 'web', 'package.json'), '{}');

    process.chdir(tempDir);
    expect(() => validateProjectRoot()).not.toThrow();
  });

  it('fails when cwd looks like a subdirectory (e.g. packages/server)', () => {
    // Simulate being in packages/server/ — has package.json but not the sentinels
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), '{}');
    writeFileSync(join(tempDir, 'src', 'index.ts'), '');

    process.chdir(tempDir);
    expect(() => validateProjectRoot()).toThrow(/not the project root/);
  });

  it('includes cwd path in error message for debugging', () => {
    process.chdir(tempDir);
    expect(() => validateProjectRoot()).toThrow(tempDir);
  });
});
