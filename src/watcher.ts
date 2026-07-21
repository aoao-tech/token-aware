import * as fs from "node:fs";
import * as vscode from "vscode";

/**
 * Watches a base directory recursively for changes to `.jsonl` files and fires
 * a debounced callback with the changed relative path. Used to detect agent
 * turns (transcript writes) for both Cursor and Claude.
 */
export class JsonlWatcher implements vscode.Disposable {
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private lastPath: string | undefined;

  constructor(
    private readonly baseDir: string,
    private readonly onChange: (relPath: string) => void,
    private readonly debounceMs = 1200
  ) {}

  start(): void {
    this.stop();
    if (!fs.existsSync(this.baseDir)) {
      return;
    }
    try {
      this.watcher = fs.watch(this.baseDir, { recursive: true }, (_event, filename) => {
        if (!filename) {
          return;
        }
        const name = filename.toString();
        if (name.endsWith(".jsonl")) {
          this.lastPath = name;
          this.trigger();
        }
      });
    } catch {
      this.watcher = undefined;
    }
  }

  private trigger(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
    }
    const p = this.lastPath;
    this.debounce = setTimeout(() => {
      if (p) {
        this.onChange(p);
      }
    }, this.debounceMs);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}
