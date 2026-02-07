import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { takeSnapshot } from "./snapshotService";
import { useSnapshotStore } from "../stores/snapshotStore";
import { useProjectStore } from "../stores/projectStore";

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export async function selectProjectFolder(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });

    console.log("Dialog returned:", selected);

    if (selected && typeof selected === "string") {
      await invoke("set_project_path", { path: selected });
      return selected;
    }

    return null;
  } catch (error) {
    console.error("selectProjectFolder error:", error);
    throw error;
  }
}

export async function getProjectPath(): Promise<string | null> {
  return await invoke("get_project_path");
}

export async function readDirectory(path: string, depth: number = 3): Promise<FileEntry[]> {
  return await invoke("read_directory", { path, depth });
}

export async function readFile(path: string): Promise<string> {
  return await invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  // Auto-snapshot before writing
  const projectPath = useProjectStore.getState().projectPath;
  if (projectPath) {
    try {
      const snapshot = await takeSnapshot(projectPath, path, "write");
      if (snapshot) {
        useSnapshotStore.getState().addSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Snapshot failed (write continues):", error);
    }
  }

  return await invoke("write_file", { path, content });
}

export async function createDirectory(path: string): Promise<void> {
  return await invoke("create_directory", { path });
}

export async function deletePath(path: string): Promise<void> {
  // Auto-snapshot before deleting
  const projectPath = useProjectStore.getState().projectPath;
  if (projectPath) {
    try {
      const snapshot = await takeSnapshot(projectPath, path, "delete");
      if (snapshot) {
        useSnapshotStore.getState().addSnapshot(snapshot);
      }
    } catch (error) {
      console.error("Snapshot failed (delete continues):", error);
    }
  }

  return await invoke("delete_path", { path });
}

const BINARY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".lock", ".map"
];

export async function readAllProjectFiles(
  entries: FileEntry[],
  maxTotalChars: number = 100000
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  let totalChars = 0;

  async function walk(items: FileEntry[]) {
    for (const entry of items) {
      if (totalChars >= maxTotalChars) break;

      if (entry.is_dir) {
        if (entry.children) {
          await walk(entry.children);
        }
      } else {
        // Skip binary files
        const ext = "." + (entry.name.split(".").pop()?.toLowerCase() || "");
        if (BINARY_EXTENSIONS.includes(ext)) continue;

        try {
          const content = await readFile(entry.path);
          if (totalChars + content.length > maxTotalChars) {
            // Add truncated
            files.push({
              path: entry.path,
              content: content.slice(0, maxTotalChars - totalChars) + "\n... (truncated)",
            });
            totalChars = maxTotalChars;
            break;
          }
          files.push({ path: entry.path, content });
          totalChars += content.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(entries);
  return files;
}