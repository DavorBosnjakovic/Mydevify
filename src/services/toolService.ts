import { readFile, writeFile, readDirectory, createDirectory, deletePath, FileEntry } from "./fileService";
import { updateManifestEntry, removeManifestEntry, getRelativePath, ProjectManifest } from "./manifestService";
import { executeConnectionTool, connectionToolPrompt } from "./connectionTool";
import { invoke } from "@tauri-apps/api/core";

// ── Tool Definitions ───────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: string;
}

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a file. Use this to inspect code, configs, or any text file in the project.",
    parameters: '{"path": "relative/path/to/file"}',
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Always provide the COMPLETE file content.",
    parameters: '{"path": "relative/path/to/file", "content": "full file content here"}',
  },
  {
    name: "list_directory",
    description: "List files and subdirectories in a directory. Returns names, types, and sizes.",
    parameters: '{"path": "relative/path/to/dir"}',
  },
  {
    name: "create_directory",
    description: "Create a new directory (including parent directories if needed).",
    parameters: '{"path": "relative/path/to/new/dir"}',
  },
  {
    name: "delete_file",
    description: "Delete a file or directory.",
    parameters: '{"path": "relative/path/to/file"}',
  },
  {
    name: "read_multiple_files",
    description: "Read multiple files at once. More efficient than multiple read_file calls.",
    parameters: '{"paths": ["path/to/file1", "path/to/file2"]}',
  },
  {
    name: "run_command",
    description: "Run a shell command in the project directory. Use for: running scripts (python, node), installing packages, running tests, building projects, or any CLI task. Returns stdout, stderr, and exit code. Be cautious with destructive commands — confirm with the user first.",
    parameters: '{"command": "npm test"}',
  },
  {
    name: "connection",
    description: "Interact with connected external services (Vercel, GitHub, Supabase, Cloudflare). Specify provider, action, and parameters.",
    parameters: '{"provider": "vercel", "action": "list_projects", "params": {}}',
  },
];

// ── Tool Call Parsing ──────────────────────────────────────────

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ParsedResponse {
  textBefore: string;
  toolCalls: ToolCall[];
  textAfter: string;
  hasToolCalls: boolean;
}

/**
 * Parse AI response for tool calls.
 */
export function parseToolCalls(response: string): ParsedResponse {
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const toolCalls: ToolCall[] = [];
  let match;
  let firstMatchIndex = -1;
  let lastMatchEnd = 0;

  while ((match = toolCallRegex.exec(response)) !== null) {
    if (firstMatchIndex === -1) {
      firstMatchIndex = match.index;
    }
    lastMatchEnd = match.index + match[0].length;

    const raw = match[1].trim();
    const parsed = parseToolCallContent(raw);
    if (parsed) {
      toolCalls.push(parsed);
    }
  }

  const textBefore = firstMatchIndex >= 0 ? response.slice(0, firstMatchIndex).trim() : response;
  const textAfter = lastMatchEnd > 0 ? response.slice(lastMatchEnd).trim() : "";

  if (toolCalls.length === 0) {
    return {
      textBefore: response,
      toolCalls: [],
      textAfter: "",
      hasToolCalls: false,
    };
  }

  return { textBefore, toolCalls, textAfter, hasToolCalls: true };
}

/**
 * Try multiple strategies to parse a single tool call's content.
 * Returns null only if ALL strategies fail.
 */
function parseToolCallContent(raw: string): ToolCall | null {
  // Strategy 1: Clean JSON then parse
  try {
    const cleaned = cleanJsonString(raw);
    const parsed = JSON.parse(cleaned);
    if (parsed.name) {
      const args = parsed.arguments || {};
      for (const key of Object.keys(parsed)) {
        if (key !== "name" && key !== "arguments") {
          args[key] = parsed[key];
        }
      }
      return { name: parsed.name, arguments: args };
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Manual regex extraction (handles triple-quotes, malformed JSON)
  const extracted = extractToolCallManually(raw);
  if (extracted) return extracted;

  // Strategy 3: Line-based fallback parsing
  const fallback = parseToolCallFallback(raw);
  if (fallback) return fallback;

  console.warn("All tool call parse strategies failed for:", raw.slice(0, 200));
  return null;
}

/**
 * Clean up JSON strings that local models produce with issues.
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw;

  // Remove $(root)/ or similar path prefixes models invent
  cleaned = cleaned.replace(/\$\([^)]*\)\//g, "");

  // ── Fix triple-quoted strings ("""...""") ──────────────────
  cleaned = cleaned.replace(
    /:\s*"{3,}\n?([\s\S]*?)"{3,}/g,
    (_match, content) => {
      const escaped = content
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      return `: "${escaped}"`;
    }
  );

  // ── Fix backtick-quoted strings (```...```) ────────────────
  cleaned = cleaned.replace(
    /:\s*`{1,3}\n?([\s\S]*?)`{1,3}/g,
    (_match, content) => {
      const escaped = content
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      return `: "${escaped}"`;
    }
  );

  // ── Fix single-quoted strings ──────────────────────────────
  cleaned = cleaned.replace(
    /"(\w+)":\s*'([^'\n]*)'/g,
    '"$1": "$2"'
  );

  // ── Fix trailing commas ────────────────────────────────────
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  // ── Test if valid now ──────────────────────────────────────
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Try fixing unescaped newlines in content strings
    cleaned = cleaned.replace(
      /("(?:content|text|body|code|data)":\s*")([\s\S]*?)("[\s]*[,}])/g,
      (_match, prefix, content, suffix) => {
        const escaped = content
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t");
        return `${prefix}${escaped}${suffix}`;
      }
    );
  }

  return cleaned;
}

/**
 * Manual regex extraction for severely malformed tool calls.
 * Handles triple-quotes, multi-line content, weird formatting.
 */
function extractToolCallManually(text: string): ToolCall | null {
  // Extract tool name
  const nameMatch = text.match(/"name"\s*:\s*"(\w+)"/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  // Map common mistakes to real tool names
  const toolNameMap: Record<string, string> = {
    create_file: "write_file",
    new_file: "write_file",
    make_file: "write_file",
    save_file: "write_file",
    make_directory: "create_directory",
    mkdir: "create_directory",
    new_directory: "create_directory",
    remove_file: "delete_file",
    rm: "delete_file",
    cat: "read_file",
    get_file: "read_file",
    ls: "list_directory",
    execute_command: "run_command",
    exec: "run_command",
    shell: "run_command",
    bash: "run_command",
    run: "run_command",
    terminal: "run_command",
  };

  const resolvedName = toolNameMap[name] || name;
  if (!AVAILABLE_TOOLS.some((t) => t.name === resolvedName)) return null;

  const args: Record<string, any> = {};

  // Extract "path" value — try multiple patterns
  const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
  if (pathMatch) {
    // Clean up invented path prefixes
    args.path = pathMatch[1].replace(/^\$\([^)]*\)\//, "").replace(/^\.\//, "");
  }

  // Extract "content" — handle triple-quotes, backticks, and regular strings
  const tripleQuoteMatch = text.match(/"content"\s*:\s*"{3,}\n?([\s\S]*?)"{3,}/);
  const backtickMatch = text.match(/"content"\s*:\s*`{1,3}\n?([\s\S]*?)`{1,3}/);

  if (tripleQuoteMatch) {
    args.content = tripleQuoteMatch[1];
  } else if (backtickMatch) {
    args.content = backtickMatch[1];
  } else {
    // Try to extract regular JSON string content
    const contentIdx = text.indexOf('"content"');
    if (contentIdx >= 0) {
      const afterContent = text.slice(contentIdx);
      const colonIdx = afterContent.indexOf(":");
      if (colonIdx >= 0) {
        const valueStart = afterContent.slice(colonIdx + 1).trimStart();
        if (valueStart.startsWith('"')) {
          // Walk through the string finding the real end quote
          let i = 1;
          let content = "";
          let escaped = false;
          while (i < valueStart.length) {
            if (escaped) {
              // Handle escape sequences
              switch (valueStart[i]) {
                case "n": content += "\n"; break;
                case "t": content += "\t"; break;
                case "r": content += "\r"; break;
                case '"': content += '"'; break;
                case "\\": content += "\\"; break;
                default: content += valueStart[i];
              }
              escaped = false;
            } else if (valueStart[i] === "\\") {
              escaped = true;
            } else if (valueStart[i] === '"') {
              break;
            } else {
              content += valueStart[i];
            }
            i++;
          }
          if (content.length > 0) {
            args.content = content;
          }
        }
      }
    }
  }

  // Extract "command" value (for run_command tool)
  const commandMatch = text.match(/"command"\s*:\s*"([^"]+)"/);
  if (commandMatch) {
    args.command = commandMatch[1];
  }

  // Extract "paths" array
  const pathsMatch = text.match(/"paths"\s*:\s*\[([\s\S]*?)\]/);
  if (pathsMatch) {
    const items: string[] = [];
    const itemRegex = /"([^"]+)"/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(pathsMatch[1])) !== null) {
      items.push(itemMatch[1]);
    }
    if (items.length > 0) args.paths = items;
  }

  // Extract connection-specific fields: "provider", "action", "params"
  const providerMatch = text.match(/"provider"\s*:\s*"([^"]+)"/);
  if (providerMatch) args.provider = providerMatch[1];

  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch) args.action = actionMatch[1];

  // Extract "params" object for connection tool
  const paramsMatch = text.match(/"params"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
  if (paramsMatch) {
    try {
      args.params = JSON.parse(paramsMatch[1]);
    } catch {
      // Keep as-is if we can't parse
    }
  }

  return { name: resolvedName, arguments: args };
}

/**
 * Line-based fallback parser.
 */
function parseToolCallFallback(text: string): ToolCall | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  let name = lines[0];
  let startLine = 1;

  if (name.toLowerCase().startsWith("name:")) {
    name = name.slice(5).trim().replace(/^["']|["']$/g, "");
    startLine = 1;
  }

  if (!AVAILABLE_TOOLS.some((t) => t.name === name)) return null;

  const args: Record<string, any> = {};
  for (let i = startLine; i < lines.length; i++) {
    const colonIndex = lines[i].indexOf(":");
    if (colonIndex > 0) {
      const key = lines[i].slice(0, colonIndex).trim().replace(/^["']|["']$/g, "");
      let value: any = lines[i].slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (value.startsWith("[") || value.startsWith("{")) {
        try { value = JSON.parse(value); } catch { /* keep as string */ }
      }

      args[key] = value;
    }
  }

  return { name, arguments: args };
}

// ── Argument Resolution ────────────────────────────────────────

function resolvePathArg(args: Record<string, any>): string | undefined {
  const pathKeys = ["path", "directory", "dir", "folder", "filepath", "file_path", "file", "filename", "name", "location"];

  for (const key of pathKeys) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== "") {
      let path = String(args[key]).trim();
      // Clean up invented prefixes
      path = path.replace(/^\$\([^)]*\)\//, "").replace(/^\.\//, "");
      return path;
    }
  }

  return undefined;
}

function resolveContentArg(args: Record<string, any>): string | undefined {
  const contentKeys = ["content", "contents", "text", "data", "body", "code", "file_content"];

  for (const key of contentKeys) {
    if (args[key] !== undefined && args[key] !== null) {
      return String(args[key]);
    }
  }

  return undefined;
}

function resolvePathsArg(args: Record<string, any>): string[] | undefined {
  const pathsKeys = ["paths", "files", "file_paths", "filenames"];

  for (const key of pathsKeys) {
    if (Array.isArray(args[key]) && args[key].length > 0) {
      return args[key].map((p: any) => String(p).trim());
    }
  }

  if (Array.isArray(args.path)) {
    return args.path.map((p: any) => String(p).trim());
  }

  return undefined;
}

function resolveCommandArg(args: Record<string, any>): string | undefined {
  const commandKeys = ["command", "cmd", "script", "run", "exec"];

  for (const key of commandKeys) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== "") {
      return String(args[key]).trim();
    }
  }

  return undefined;
}

// ── Tool Execution ─────────────────────────────────────────────

export interface ToolResult {
  tool: string;
  success: boolean;
  result: string;
  filesChanged?: string[];
}

/**
 * Execute a single tool call and return the result.
 */
export async function executeTool(
  toolCall: ToolCall,
  projectPath: string,
  manifest: ProjectManifest | null
): Promise<{ result: ToolResult; updatedManifest: ProjectManifest | null }> {
  const { name, arguments: args } = toolCall;
  let updatedManifest = manifest;

  try {
    switch (name) {
      case "read_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"read_file\", \"arguments\": {\"path\": \"filename.ext\"}}");
        }
        const filePath = resolveProjectPath(projectPath, path);
        const content = await readFile(filePath);
        return {
          result: {
            tool: name,
            success: true,
            result: `Contents of ${path}:\n\`\`\`\n${content}\n\`\`\``,
          },
          updatedManifest,
        };
      }

      case "read_multiple_files": {
        const paths = resolvePathsArg(args);
        if (!paths || paths.length === 0) {
          throw new Error("Missing 'paths' parameter. Use: {\"name\": \"read_multiple_files\", \"arguments\": {\"paths\": [\"file1\", \"file2\"]}}");
        }
        const results: string[] = [];
        for (const p of paths) {
          try {
            const filePath = resolveProjectPath(projectPath, p);
            const content = await readFile(filePath);
            results.push(`### ${p}\n\`\`\`\n${content}\n\`\`\``);
          } catch (e: any) {
            results.push(`### ${p}\nError: ${e.message}`);
          }
        }
        return {
          result: { tool: name, success: true, result: results.join("\n\n") },
          updatedManifest,
        };
      }

      case "write_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"write_file\", \"arguments\": {\"path\": \"filename.ext\", \"content\": \"file content\"}}");
        }
        const content = resolveContentArg(args);
        if (content === undefined) {
          throw new Error("Missing 'content' parameter. The content must be a JSON string with \\n for newlines. Use: {\"name\": \"write_file\", \"arguments\": {\"path\": \"" + path + "\", \"content\": \"<!DOCTYPE html>\\n<html>...</html>\"}}");
        }

        const filePath = resolveProjectPath(projectPath, path);

        // Ensure parent directory exists
        const parentDir = filePath.replace(/[/\\][^/\\]+$/, "");
        try {
          await createDirectory(parentDir);
        } catch {
          // Directory might already exist
        }

        await writeFile(filePath, content);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = updateManifestEntry(updatedManifest, relativePath, content);
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Written: ${path} (${content.length} chars, ${content.split("\n").length} lines)`,
            filesChanged: [path],
          },
          updatedManifest,
        };
      }

      case "list_directory": {
        const path = resolvePathArg(args) || ".";
        const dirPath = path === "." || path === "" || path === "/"
          ? projectPath
          : resolveProjectPath(projectPath, path);
        const entries = await readDirectory(dirPath, 2);
        const listing = formatDirectoryListing(entries, "");
        return {
          result: {
            tool: name,
            success: true,
            result: `Contents of ${path || "project root"}:\n${listing}`,
          },
          updatedManifest,
        };
      }

      case "create_directory": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"create_directory\", \"arguments\": {\"path\": \"dirname\"}}");
        }

        // ── Safety: prevent creating "directories" that look like files ──
        const hasExtension = /\.\w{1,10}$/.test(path);
        if (hasExtension) {
          // The model confused create_directory with write_file
          // Try to recover: if there's content, write a file instead
          const content = resolveContentArg(args);
          if (content) {
            const filePath = resolveProjectPath(projectPath, path);
            const parentDir = filePath.replace(/[/\\][^/\\]+$/, "");
            try { await createDirectory(parentDir); } catch { /* ok */ }
            await writeFile(filePath, content);
            if (updatedManifest) {
              const relativePath = getRelativePath(projectPath, filePath);
              updatedManifest = updateManifestEntry(updatedManifest, relativePath, content);
            }
            return {
              result: {
                tool: "write_file",
                success: true,
                result: `✅ Written: ${path} (auto-corrected from create_directory to write_file)`,
                filesChanged: [path],
              },
              updatedManifest,
            };
          }
          // No content — reject with helpful error
          throw new Error(`"${path}" looks like a file, not a directory. Use write_file instead: {"name": "write_file", "arguments": {"path": "${path}", "content": "..."}}`);
        }

        const dirPath = resolveProjectPath(projectPath, path);
        await createDirectory(dirPath);
        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Created directory: ${path}`,
          },
          updatedManifest,
        };
      }

      case "delete_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"delete_file\", \"arguments\": {\"path\": \"filename.ext\"}}");
        }
        const filePath = resolveProjectPath(projectPath, path);
        await deletePath(filePath);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = removeManifestEntry(updatedManifest, relativePath);
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Deleted: ${path}`,
            filesChanged: [path],
          },
          updatedManifest,
        };
      }

      case "run_command": {
        const command = resolveCommandArg(args);
        if (!command) {
          throw new Error('Missing \'command\' parameter. Use: {"name": "run_command", "arguments": {"command": "npm test"}}');
        }

        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
          command,
          cwd: projectPath,
        });

        const output: string[] = [];
        if (result.stdout.trim()) {
          output.push(`stdout:\n${result.stdout.trim()}`);
        }
        if (result.stderr.trim()) {
          output.push(`stderr:\n${result.stderr.trim()}`);
        }
        output.push(`Exit code: ${result.exit_code}`);

        return {
          result: {
            tool: name,
            success: result.exit_code === 0,
            result: output.join("\n\n"),
          },
          updatedManifest,
        };
      }

      case "connection": {
        const provider = args.provider;
        const action = args.action;
        const params = args.params || {};

        if (!provider || !action) {
          throw new Error('Missing provider or action. Use: {"name": "connection", "arguments": {"provider": "vercel", "action": "list_projects", "params": {}}}');
        }

        const result = await executeConnectionTool({ provider, action, params });
        return {
          result: {
            tool: "connection",
            success: !result.startsWith("Error:"),
            result,
          },
          updatedManifest,
        };
      }

      default:
        return {
          result: {
            tool: name,
            success: false,
            result: `Unknown tool: ${name}. Available tools are: ${AVAILABLE_TOOLS.map(t => t.name).join(", ")}`,
          },
          updatedManifest,
        };
    }
  } catch (error: any) {
    const message = error?.message || error?.toString() || "Unknown error";
    return {
      result: {
        tool: name,
        success: false,
        result: `❌ Error executing ${name}: ${message}`,
      },
      updatedManifest,
    };
  }
}

/**
 * Execute all tool calls in sequence and return combined results.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  projectPath: string,
  manifest: ProjectManifest | null
): Promise<{ results: ToolResult[]; updatedManifest: ProjectManifest | null; filesChanged: string[] }> {
  const results: ToolResult[] = [];
  let currentManifest = manifest;
  const allFilesChanged: string[] = [];

  for (const toolCall of toolCalls) {
    const { result, updatedManifest } = await executeTool(toolCall, projectPath, currentManifest);
    results.push(result);
    currentManifest = updatedManifest;
    if (result.filesChanged) {
      allFilesChanged.push(...result.filesChanged);
    }
  }

  return {
    results,
    updatedManifest: currentManifest,
    filesChanged: allFilesChanged,
  };
}

/**
 * Format tool results into a message to send back to the AI.
 */
export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 1) {
    return `<tool_result>\n${results[0].result}\n</tool_result>`;
  }

  return results
    .map((r) => `<tool_result>\n[${r.tool}] ${r.result}\n</tool_result>`)
    .join("\n\n");
}

// ── System Prompt ──────────────────────────────────────────────

export function buildToolsPrompt(): string {
  let prompt = `\n## Available Tools

You have tools to work with project files. You MUST use these tools to create and edit files.

FORMAT — use this EXACT format (do NOT put inside code blocks):

<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

### Tools:

`;

  for (const tool of AVAILABLE_TOOLS) {
    prompt += `**${tool.name}** — ${tool.description}\n`;
    prompt += `Parameters: ${tool.parameters}\n\n`;
  }

  prompt += `### CORRECT Example — creating a website:

I'll create the website files.

<tool_call>{"name": "write_file", "arguments": {"path": "index.html", "content": "<!DOCTYPE html>\\n<html>\\n<head>\\n<title>My Site</title>\\n<link rel=\\"stylesheet\\" href=\\"styles.css\\"/>\\n</head>\\n<body>\\n<nav><a href=\\"index.html\\">Home</a> <a href=\\"about.html\\">About</a></nav>\\n<h1>Welcome</h1>\\n</body>\\n</html>"}}</tool_call>

<tool_call>{"name": "write_file", "arguments": {"path": "about.html", "content": "<!DOCTYPE html>\\n<html>\\n<head><title>About</title></head>\\n<body>\\n<nav><a href=\\"index.html\\">Home</a> <a href=\\"about.html\\">About</a></nav>\\n<h1>About Us</h1>\\n</body>\\n</html>"}}</tool_call>

<tool_call>{"name": "write_file", "arguments": {"path": "styles.css", "content": "body { font-family: sans-serif; margin: 0; padding: 20px; }\\nnav { background: #333; padding: 10px; }\\nnav a { color: white; margin-right: 15px; }"}}</tool_call>

### CORRECT Example — running a command:

<tool_call>{"name": "run_command", "arguments": {"command": "npm test"}}</tool_call>

### CORRECT Example — using a connected service:

<tool_call>{"name": "connection", "arguments": {"provider": "vercel", "action": "list_projects", "params": {}}}</tool_call>

<tool_call>{"name": "connection", "arguments": {"provider": "github", "action": "create_repo", "params": {"name": "my-project", "private": true}}}</tool_call>

### RULES:
1. Use write_file for ALL files (HTML, CSS, JS). Do NOT use create_directory for files.
2. The "content" value MUST be a single-line JSON string. Use \\n for newlines, \\" for quotes. NEVER use triple quotes or multi-line strings.
3. Place index.html at the project root. NOT inside src/ or public/.
4. Use relative paths WITH extensions for links: href="about.html" (NOT href="/about").
5. You can create multiple files in one response using multiple <tool_call> blocks.
6. write_file auto-creates parent directories — you do NOT need to call create_directory first.
7. Always provide COMPLETE file content. Do not use placeholders.
8. For the connection tool, always check the system prompt to see which services are connected before using them.
9. Use run_command to execute scripts, install packages, run tests, or any shell command. The command runs in the project directory.
`;

  // Add detailed connection tool documentation
  prompt += connectionToolPrompt;

  return prompt;
}

// ── Helpers ────────────────────────────────────────────────────

function resolveProjectPath(projectPath: string, relativePath: string): string {
  const normalized = relativePath
    .replace(/^\$\([^)]*\)\//, "") // Remove $(root)/ etc.
    .replace(/^\.\//, "")          // Remove ./
    .replace(/^[/\\]+/, "")        // Remove leading slashes
    .replace(/\//g, "\\");         // Normalize to backslash
  return `${projectPath}\\${normalized}`;
}

function formatDirectoryListing(entries: FileEntry[], indent: string): string {
  let result = "";
  for (const entry of entries) {
    if (entry.is_dir) {
      result += `${indent}📁 ${entry.name}/\n`;
      if (entry.children) {
        result += formatDirectoryListing(entry.children, indent + "  ");
      }
    } else {
      result += `${indent}  ${entry.name}\n`;
    }
  }
  return result;
}