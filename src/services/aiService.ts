import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { ProjectManifest, manifestToString } from "./manifestService";
import { buildToolsPrompt } from "./toolService";
import { getConnectionsSummary } from "./connectionTool";
import type { MessageImage } from "../stores/chatStore";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: MessageImage[];
}

interface Provider {
  id: string;
  apiKey: string;
  model: string;
  endpoint?: string;
}

interface ProjectContext {
  path: string;
  manifest: ProjectManifest | null;
  currentFile?: {
    name: string;
    content: string;
  };
}

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  ollama: "http://localhost:11434/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
};

export function buildSystemPrompt(context?: ProjectContext): string {
  let prompt = `You are Mydevify, an AI development assistant built into a desktop app. You help users build websites and applications by generating code.

When generating code:
- Generate complete, working files
- Use modern best practices
- If creating HTML, include all CSS and JS in the same file unless asked otherwise
- When editing existing files, provide the complete updated file

IMPORTANT: You have direct access to project files through tools. You MUST use them:
- Use read_file to see file contents — never guess or ask the user to show you
- Use write_file to create and edit files — never ask the user to copy/paste code
- Use create_directory to make folders — never tell the user to create them
- ALWAYS take action with tools. NEVER say "you should" or "you can" — just DO IT.
`;

  if (context) {
    prompt += `\n## Current Project\n- **Path:** ${context.path}\n`;

    if (context.manifest) {
      prompt += `\n## Project Structure\n\`\`\`\n${manifestToString(context.manifest)}\`\`\`\n`;
      prompt += `\nYou can see the file names and sizes above. Use the read_file tool to inspect any file. Use write_file to create or edit files.\n`;
    }

    if (context.currentFile) {
      prompt += `\n## Currently Open File: ${context.currentFile.name}\n\`\`\`\n${context.currentFile.content}\n\`\`\`\n`;
    }

    prompt += buildToolsPrompt();
  }

  // Add connected services context
  const connectionContext = getConnectionsSummary();
  prompt += `\n## External Services\n${connectionContext}\n`;

  return prompt;
}

export function flattenFileTree(entries: any[], prefix = ""): string {
  let result = "";
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.is_dir) {
      result += `📁 ${path}/\n`;
      if (entry.children) {
        result += flattenFileTree(entry.children, path);
      }
    } else {
      result += `  ${path}\n`;
    }
  }
  return result;
}

// ——— Format messages with images for each provider ——————————————

function formatAnthropicMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: img.base64,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });
}

function formatOpenAIMessages(messages: Message[], systemPrompt: string) {
  const formatted: any[] = [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      formatted.push({ role: m.role, content });
    } else {
      formatted.push({ role: m.role, content: m.content });
    }
  }

  return formatted;
}

function formatGoogleMessages(messages: Message[], systemPrompt: string) {
  const contents: any[] = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood. I'm ready to help." }] },
  ];

  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    // Images first
    if (m.images && m.images.length > 0) {
      for (const img of m.images) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64,
          },
        });
      }
    }
    // Then text
    if (m.content) {
      parts.push({ text: m.content });
    }

    contents.push({ role, parts });
  }

  return contents;
}

// ——— Main send function —————————————————————————————————————————

export async function sendMessage(
  messages: Message[],
  provider: Provider,
  onStream?: (chunk: string) => void,
  projectContext?: ProjectContext,
  signal?: AbortSignal,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  let endpoint = provider.endpoint || ENDPOINTS[provider.id];
  const systemPrompt = buildSystemPrompt(projectContext);

  if (provider.id === "ollama" && provider.apiKey) {
    const baseUrl = provider.apiKey.replace(/\/+$/, "");
    endpoint = `${baseUrl}/v1/chat/completions`;
  }

  if (provider.id === "anthropic") {
    return await sendAnthropicMessage(messages, provider, systemPrompt, onStream, onReader);
  } else if (provider.id === "google") {
    return await sendGoogleMessage(messages, provider, systemPrompt);
  } else {
    return await sendOpenAICompatibleMessage(messages, provider, endpoint, systemPrompt, onStream, onReader);
  }
}

async function sendOpenAICompatibleMessage(
  messages: Message[],
  provider: Provider,
  endpoint: string,
  systemPrompt: string,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const allMessages = formatOpenAIMessages(messages, systemPrompt);

  const body: any = {
    model: provider.model,
    messages: allMessages,
    stream: !!onStream,
  };

  // Ask for usage data in streaming mode (OpenAI & Groq support this)
  if (onStream) {
    body.stream_options = { include_usage: true };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  if (onStream && response.body) {
    const reader = response.body.getReader();
    if (onReader) onReader(reader);
    const decoder = new TextDecoder();
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) {
              fullContent += content;
              onStream(content);
            }
            // Capture usage from the final chunk (OpenAI/Groq send it here)
            if (parsed.usage) {
              usage.inputTokens = parsed.usage.prompt_tokens || 0;
              usage.outputTokens = parsed.usage.completion_tokens || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (e: any) {
      // Reader was cancelled (user hit stop) — return what we have
      return { text: fullContent, usage };
    }

    return { text: fullContent, usage };
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.prompt_tokens || 0;
    usage.outputTokens = data.usage.completion_tokens || 0;
  }

  return { text: data.choices?.[0]?.message?.content || "", usage };
}

async function sendAnthropicMessage(
  messages: Message[],
  provider: Provider,
  systemPrompt: string,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const formattedMessages = formatAnthropicMessages(messages);

  const response = await fetch(ENDPOINTS.anthropic, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: formattedMessages,
      stream: !!onStream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  if (onStream && response.body) {
    const reader = response.body.getReader();
    if (onReader) onReader(reader);
    const decoder = new TextDecoder();
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);

            // Content streaming
            if (parsed.type === "content_block_delta") {
              const content = parsed.delta?.text || "";
              if (content) {
                fullContent += content;
                onStream(content);
              }
            }

            // Anthropic sends input tokens in message_start
            if (parsed.type === "message_start" && parsed.message?.usage) {
              usage.inputTokens = parsed.message.usage.input_tokens || 0;
              usage.cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens || 0;
              usage.cacheReadTokens = parsed.message.usage.cache_read_input_tokens || 0;
            }

            // Anthropic sends output tokens in message_delta
            if (parsed.type === "message_delta" && parsed.usage) {
              usage.outputTokens = parsed.usage.output_tokens || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (e: any) {
      // Reader was cancelled (user hit stop) — return what we have
      return { text: fullContent, usage };
    }

    return { text: fullContent, usage };
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.input_tokens || 0;
    usage.outputTokens = data.usage.output_tokens || 0;
    usage.cacheCreationTokens = data.usage.cache_creation_input_tokens || 0;
    usage.cacheReadTokens = data.usage.cache_read_input_tokens || 0;
  }

  return { text: data.content?.[0]?.text || "", usage };
}

async function sendGoogleMessage(
  messages: Message[],
  provider: Provider,
  systemPrompt: string
): Promise<{ text: string; usage: UsageData }> {
  const endpoint = `${ENDPOINTS.google}/${provider.model}:generateContent?key=${provider.apiKey}`;
  const contents = formatGoogleMessages(messages, systemPrompt);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  // Google sends usage in usageMetadata
  if (data.usageMetadata) {
    usage.inputTokens = data.usageMetadata.promptTokenCount || 0;
    usage.outputTokens = data.usageMetadata.candidatesTokenCount || 0;
  }

  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "", usage };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}