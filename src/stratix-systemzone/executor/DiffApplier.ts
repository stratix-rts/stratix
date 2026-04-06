// ============================================
// DiffApplier.ts - Unified Diff 应用器
// Agent 化重设计：支持 git apply + fallback 策略
// ============================================

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import type { DiffHunk, DiffLine } from "../types";

// ------------------------------------------------
// Result Types
// ------------------------------------------------

export interface DiffValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DiffApplyResult {
  success: boolean;
  appliedFiles: string[];
  errors: string[];
}

export interface DiffPreviewLine {
  type: "context" | "add" | "remove";
  content: string;
  lineNo?: number;
}

export interface DiffPreviewHunk {
  header: string;
  lines: DiffPreviewLine[];
}

export interface DiffPreviewFile {
  path: string;
  hunks: DiffPreviewHunk[];
}

// ------------------------------------------------
// Internal: Parsed Hunk
// ------------------------------------------------

interface ParsedHunk {
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

// ------------------------------------------------
// DiffApplier Class
// ------------------------------------------------

export class DiffApplier {
  async validateDiff(workDir: string, diff: string): Promise<DiffValidationResult> {
    try {
      execSync("git apply --check", {
        input: diff,
        cwd: workDir,
        timeout: 10_000,
        encoding: "utf-8",
      });
      return { valid: true, errors: [] };
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? err.message ?? "";
      return { valid: false, errors: [stderr.trim()] };
    }
  }

  async applyDiff(workDir: string, diff: string): Promise<DiffApplyResult> {
    const validation = await this.validateDiff(workDir, diff);
    if (validation.valid) {
      try {
        execSync("git apply", {
          input: diff,
          cwd: workDir,
          timeout: 30_000,
          encoding: "utf-8",
        });
        return { success: true, appliedFiles: this.extractFilePaths(diff), errors: [] };
      } catch {
        // git apply --check passed but git apply failed (rare), fall through to fallback
      }
    }
    return this.applyFallback(workDir, diff);
  }

  async previewDiff(diff: string): Promise<{ files: DiffPreviewFile[] }> {
    const hunks = this.parseDiffHunks(diff);
    const fileMap = new Map<string, DiffPreviewHunk[]>();
    for (const hunk of hunks) {
      if (!fileMap.has(hunk.filePath)) fileMap.set(hunk.filePath, []);
      fileMap.get(hunk.filePath)!.push({
        header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        lines: hunk.lines.map(l => ({ type: l.type, content: l.content })),
      });
    }
    const files: DiffPreviewFile[] = [];
    for (const [fp, hs] of fileMap) files.push({ path: fp, hunks: hs });
    return { files };
  }

  async rollbackDiff(workDir: string, diff: string): Promise<void> {
    execSync("git apply -R", { input: diff, cwd: workDir, timeout: 30_000, encoding: "utf-8" });
  }

  // ============================================
  // Private
  // ============================================

  private async applyFallback(workDir: string, diff: string): Promise<DiffApplyResult> {
    const hunks = this.parseDiffHunks(diff);
    if (hunks.length === 0) return { success: false, appliedFiles: [], errors: ["No valid hunks found in diff"] };

    const appliedHunks: Array<{ filePath: string; originalContent: string }> = [];
    const errors: string[] = [];

    for (const hunk of hunks) {
      const fullPath = path.join(workDir, hunk.filePath);
      try {
        let content: string;
        try {
          content = await fs.readFile(fullPath, "utf-8");
        } catch {
          if (hunk.oldLines === 0) {
            const newContent = hunk.lines.filter(l => l.type === "add").map(l => l.content).join("\n");
            await fs.writeFile(fullPath, newContent, "utf-8");
            appliedHunks.push({ filePath: hunk.filePath, originalContent: "" });
            continue;
          }
          errors.push(`File not found: ${hunk.filePath}`);
          continue;
        }

        const lines = content.split("\n");
        const contextLines = hunk.lines.filter(l => l.type === "context");
        let matchStart = -1;

        if (hunk.oldStart > 0 && this.verifyContextMatch(lines, contextLines, hunk.oldStart - 1)) {
          matchStart = hunk.oldStart - 1;
        }
        if (matchStart === -1) matchStart = this.searchContextMatch(lines, contextLines);

        if (matchStart === -1) {
          errors.push(`Hunk at ${hunk.filePath}:${hunk.oldStart} - context lines not found`);
          continue;
        }

        const newLines = this.applyHunkToLines(lines, hunk, matchStart);
        await fs.writeFile(fullPath, newLines.join("\n"), "utf-8");
        appliedHunks.push({ filePath: hunk.filePath, originalContent: content });
      } catch (err: any) {
        errors.push(`Failed to apply hunk to ${hunk.filePath}: ${err.message}`);
      }
    }

    if (errors.length > 0 && appliedHunks.length > 0) {
      for (const { filePath, originalContent } of appliedHunks) {
        try { await fs.writeFile(path.join(workDir, filePath), originalContent, "utf-8"); } catch { /* best effort */ }
      }
      return { success: false, appliedFiles: [], errors: [...errors, "Rolled back all applied hunks due to failures"] };
    }
    if (errors.length > 0) return { success: false, appliedFiles: [], errors };
    return { success: true, appliedFiles: [...new Set(appliedHunks.map(h => h.filePath))], errors: [] };
  }

  private verifyContextMatch(fileLines: string[], contextLines: DiffLine[], startPos: number): boolean {
    if (contextLines.length === 0) return true;
    let idx = startPos;
    for (const ctx of contextLines) {
      if (idx >= fileLines.length || fileLines[idx] !== ctx.content) return false;
      idx++;
    }
    return true;
  }

  private searchContextMatch(fileLines: string[], contextLines: DiffLine[]): number {
    if (contextLines.length === 0) return 0;
    const first = contextLines[0].content;
    for (let i = 0; i <= fileLines.length - contextLines.length; i++) {
      if (fileLines[i] === first && this.verifyContextMatch(fileLines, contextLines, i)) return i;
    }
    return -1;
  }

  private applyHunkToLines(fileLines: string[], hunk: ParsedHunk, startPos: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < startPos; i++) result.push(fileLines[i]);

    let fileIdx = startPos;
    for (const line of hunk.lines) {
      if (line.type === "context") { result.push(fileLines[fileIdx]); fileIdx++; }
      else if (line.type === "remove") { fileIdx++; }
      else if (line.type === "add") { result.push(line.content); }
    }

    const consumed = hunk.lines.filter(l => l.type === "context" || l.type === "remove").length;
    for (let i = startPos + consumed; i < fileLines.length; i++) result.push(fileLines[i]);
    return result;
  }

  private extractFilePaths(diff: string): string[] {
    const paths: string[] = [];
    const regex = /^--- a\/(.+)$/gm;
    let m;
    while ((m = regex.exec(diff)) !== null) paths.push(m[1]);
    return paths;
  }

  private parseDiffHunks(diff: string): ParsedHunk[] {
    const hunks: ParsedHunk[] = [];
    const lines = diff.split("\n");
    let currentFilePath = "";
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const oldFileMatch = line.match(/^--- a\/(.+)$/);
      if (oldFileMatch) {
        currentFilePath = oldFileMatch[1];
        i++;
        if (i < lines.length && lines[i].startsWith("+++ ")) i++;
        continue;
      }
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10);
        const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = hunkMatch[3] ? parseInt(hunkMatch[3], 10) : 1;
        const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
        const hunkLines: DiffLine[] = [];
        i++;
        while (i < lines.length) {
          const dl = lines[i];
          if (dl.startsWith("diff ") || dl.startsWith("--- ") || /^@@ /.test(dl)) break;
          if (dl.startsWith("+")) hunkLines.push({ type: "add", content: dl.slice(1) });
          else if (dl.startsWith("-")) hunkLines.push({ type: "remove", content: dl.slice(1) });
          else if (dl.startsWith(" ")) hunkLines.push({ type: "context", content: dl.slice(1) });
          else if (dl === "") {
            if (i + 1 < lines.length && (lines[i+1].startsWith("diff ") || lines[i+1].startsWith("--- ") || /^@@ /.test(lines[i+1]))) break;
            hunkLines.push({ type: "context", content: "" });
          } else break;
          i++;
        }
        hunks.push({ filePath: currentFilePath, oldStart, oldLines, newStart, newLines, lines: hunkLines });
        continue;
      }
      i++;
    }
    return hunks;
  }
}
