import path from "node:path/posix";

const CODE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const TEST_FILE_RE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_ROOTS = ["src/", "lib/", "app/"];
const TEST_ROOTS = ["test", "tests", "__tests__"];

export interface TestMapping {
  /** Unique, sorted list of test files that exist in the workspace. */
  testFiles: string[];
  /** changed file -> test files that cover it */
  bySource: Record<string, string[]>;
  /** Changed code files for which no test file could be found. */
  unmapped: string[];
  /** Changed files that were skipped (non-code, deleted, unsafe paths). */
  skipped: { file: string; reason: string }[];
}

export function isTestFile(file: string): boolean {
  return TEST_FILE_RE.test(file);
}

export function isCodeFile(file: string): boolean {
  return CODE_EXT.includes(path.extname(file));
}

/**
 * Rejects absolute paths and anything that escapes the workspace root.
 * Returned path is normalised POSIX.
 */
export function safeRelativePath(file: string): string | null {
  if (!file || file.includes("\0")) return null;
  const posix = file.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) return null;
  const norm = path.normalize(posix);
  if (norm === ".." || norm.startsWith("../") || norm === ".") return null;
  return norm;
}

/** Conventional locations of tests for a given source file, in priority order. */
export function candidateTestPaths(source: string): string[] {
  const ext = path.extname(source);
  const dir = path.dirname(source);
  const base = path.basename(source, ext);
  const exts = [ext, ...CODE_EXT.filter((e) => e !== ext)];
  const out: string[] = [];
  const push = (p: string) => {
    const n = path.normalize(p);
    if (!out.includes(n)) out.push(n);
  };

  for (const e of exts) {
    for (const kind of ["test", "spec"]) {
      push(path.join(dir, `${base}.${kind}${e}`));
      push(path.join(dir, "__tests__", `${base}.${kind}${e}`));
    }
    push(path.join(dir, "__tests__", `${base}${e}`));
  }

  // Mirrored trees: src/foo/bar.ts -> test/foo/bar.test.ts, tests/bar.test.ts, ...
  const root = SOURCE_ROOTS.find((r) => source.startsWith(r));
  const inner = root ? source.slice(root.length) : source;
  const innerDir = path.dirname(inner) === "." ? "" : path.dirname(inner);
  for (const t of TEST_ROOTS) {
    for (const e of exts) {
      for (const kind of ["test", "spec"]) {
        push(path.join(t, innerDir, `${base}.${kind}${e}`));
        if (innerDir) push(path.join(t, `${base}.${kind}${e}`));
      }
    }
  }
  return out;
}

/**
 * Maps changed files to the test files that should be run to validate them.
 * `exists` is injected so the mapping logic stays pure and unit-testable.
 */
export function mapChangedFilesToTests(
  changed: { filename: string; status?: string }[],
  exists: (relPath: string) => boolean
): TestMapping {
  const tests = new Set<string>();
  const bySource: Record<string, string[]> = {};
  const unmapped: string[] = [];
  const skipped: { file: string; reason: string }[] = [];

  for (const { filename, status } of changed) {
    const rel = safeRelativePath(filename);
    if (!rel) {
      skipped.push({ file: filename, reason: "unsafe path" });
      continue;
    }
    if (status === "removed") {
      skipped.push({ file: rel, reason: "file removed" });
      continue;
    }
    if (!isCodeFile(rel)) {
      skipped.push({ file: rel, reason: "not a code file" });
      continue;
    }
    if (isTestFile(rel)) {
      if (exists(rel)) {
        tests.add(rel);
        bySource[rel] = [rel];
      } else {
        skipped.push({ file: rel, reason: "test file not present in workspace" });
      }
      continue;
    }
    const found = candidateTestPaths(rel).filter(exists);
    if (found.length === 0) {
      unmapped.push(rel);
      continue;
    }
    bySource[rel] = found;
    for (const f of found) tests.add(f);
  }

  return { testFiles: [...tests].sort(), bySource, unmapped, skipped };
}
