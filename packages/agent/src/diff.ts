export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  file: string;
  hunks: DiffHunk[];
  /** Line numbers present on the RIGHT side of the diff (added or context). */
  rightLines: Set<number>;
}

/** Parses the multi-file unified diff returned by the `get_pr_diff` tool. */
export function parseUnifiedDiff(diff: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let current: FileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      current = undefined;
      hunk = undefined;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4).replace(/^b\//, "");
      current = { file: name, hunks: [], rightLines: new Set() };
      files.set(name, current);
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h && current) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      hunk = { header: raw, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk || !current) continue;
    if (raw.startsWith("+")) {
      hunk.lines.push({ type: "add", text: raw.slice(1), newLine });
      current.rightLines.add(newLine++);
    } else if (raw.startsWith("-")) {
      hunk.lines.push({ type: "del", text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith(" ") || raw === "") {
      hunk.lines.push({ type: "ctx", text: raw.slice(1), oldLine: oldLine++, newLine });
      current.rightLines.add(newLine++);
    }
  }
  return files;
}
