import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, User, Bot, Trash2, Save, Wrench, Pencil, Coins, X, Image } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChatStore } from "../../stores/chatStore";
import { useProjectStore } from "../../stores/projectStore";
import { useUsageStore } from "../../stores/usageStore";
import { themes } from "../../config/themes";
import { sendMessage } from "../../services/aiService";
import { writeFile, readDirectory } from "../../services/fileService";
import { updateManifestEntry, getRelativePath } from "../../services/manifestService";
import { parseToolCalls, executeToolCalls, formatToolResults } from "../../services/toolService";
import type { MessageImage } from "../../stores/chatStore";

const MAX_TOOL_ITERATIONS = 10;

// Allowed image types
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function ChatArea({ onSettingsClick }: { onSettingsClick?: (tab: string) => void }) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const stoppedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const { theme, timeFormat } = useSettingsStore();
  const { messages, isLoading, addMessage, setLoading, clearMessages } = useChatStore();
  const { projectPath, fileTree, selectedFile, setFileTree, manifest, setManifest } = useProjectStore();
  const { session, trackAPICall } = useUsageStore();
  const t = themes[theme];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatCost = (cost: number) => {
    if (cost < 0.01) return "<$0.01";
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  // ─── Image helpers ────────────────────────────────────────────────

  const fileToMessageImage = useCallback((file: File): Promise<MessageImage | null> => {
    return new Promise((resolve) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          resolve({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            base64,
            mimeType: file.type,
            name: file.name,
          });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, []);

  const blobToMessageImage = useCallback((blob: Blob, mimeType?: string): Promise<MessageImage | null> => {
    return new Promise((resolve) => {
      const type = mimeType || blob.type;
      if (!ALLOWED_IMAGE_TYPES.includes(type)) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          resolve({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            base64,
            mimeType: type,
            name: "screenshot.png",
          });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToMessageImage));
    const valid = results.filter((r): r is MessageImage => r !== null);
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid]);
    }
  }, [fileToMessageImage]);

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ─── Paste handler (works anywhere in the chat area) ──────────────

  const handlePaste = useCallback(async (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    e.preventDefault();

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (blob) {
        const img = await blobToMessageImage(blob, item.type);
        if (img) {
          setPendingImages((prev) => [...prev, img]);
        }
      }
    }

    inputRef.current?.focus();
  }, [blobToMessageImage]);

  // ─── Drag & drop handlers ────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));

    if (imageFiles.length > 0) {
      await addImages(imageFiles);
      inputRef.current?.focus();
    }
  }, [addImages]);

  // ─── Global paste listener (so Ctrl+V works even without input focus) ──

  useEffect(() => {
    const listener = (e: ClipboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      handlePaste(e as any);
    };
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, [handlePaste]);

  // ─── Provider helpers ─────────────────────────────────────────────

  const getActiveProvider = () => {
    const activeProviderId = localStorage.getItem("ai-active-provider") || "anthropic";
    const savedProviders = localStorage.getItem("ai-providers");
    
    if (!savedProviders) return null;

    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    
    if (!config || !config.apiKey) return null;

    return {
      id: activeProviderId,
      apiKey: config.apiKey,
      model: config.selectedModel,
    };
  };

  const getActiveProviderDisplay = () => {
    const activeProviderId = localStorage.getItem("ai-active-provider") || "anthropic";
    const savedProviders = localStorage.getItem("ai-providers");
    
    if (!savedProviders) return "No provider";

    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    
    if (!config) return "No provider";

    const providerNames: Record<string, string> = {
      anthropic: "Claude",
      groq: "Groq",
      openai: "OpenAI",
      google: "Gemini",
      ollama: "Ollama",
    };

    const name = providerNames[activeProviderId] || activeProviderId;
    const model = config.selectedModel?.split("-").slice(0, 2).join(" ") || "";
    
    return `${name} • ${model}`;
  };

  const handleStop = () => {
    stoppedRef.current = true;
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
    setLoading(false);
  };

  // Collapse incomplete code blocks and tool calls during streaming
  const getStreamingDisplay = (content: string): string => {
    // If there's an unclosed <tool_call> tag, hide everything from it onward
    const openTag = content.lastIndexOf("<tool_call>");
    const closeTag = content.lastIndexOf("</tool_call>");
    if (openTag !== -1 && (closeTag === -1 || closeTag < openTag)) {
      const textBefore = content.slice(0, openTag).trim();
      return textBefore || "⏳ Working on files...";
    }

    // Strip completed tool_call blocks
    const clean = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

    // Count backtick fences
    const fences = clean.match(/```/g);
    if (!fences || fences.length % 2 === 0) return content; // All code blocks are closed

    // Odd number = unclosed code block. Show text before it + placeholder
    const originalBeforeFence = content.slice(0, content.lastIndexOf("```"));
    return originalBeforeFence + "```\n⏳ Writing code...\n```";
  };

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isLoading) return;

    const userMessage = input.trim();
    const userImages = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInput("");
    setPendingImages([]);
    
    addMessage({
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
      images: userImages,
    });

    setLoading(true);
    stoppedRef.current = false;

    try {
      const provider = getActiveProvider();

      if (!provider) {
        throw new Error("No API key configured. Go to Settings → API Keys to add one and set it as active.");
      }

      // Build project context
      let projectContext = undefined;
      if (projectPath) {
        projectContext = {
          path: projectPath,
          manifest: manifest,
        };
      }

      // Build conversation history (include images)
      const existingMessages = messages
        .filter((m) => m.content && m.content.trim() !== "" && m.content !== "Thinking...")
        .map((m) => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content,
          images: m.images,
        }));
      
      let apiMessages = [
        ...existingMessages,
        { role: "user" as const, content: userMessage, images: userImages }
      ];

      // ── Tool execution loop ──────────────────────────────
      let iterations = 0;
      let currentManifest = manifest;

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Check if stopped
        if (stoppedRef.current) break;

        // Create assistant message placeholder
        const assistantId = (Date.now() + iterations).toString();
        addMessage({
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        });

        // Stream the AI response
        let fullResponse = "";

        const result = await sendMessage(apiMessages, provider, (chunk) => {
          if (stoppedRef.current) return;
          fullResponse += chunk;
          const displayContent = getStreamingDisplay(fullResponse);
          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: displayContent } : m
            ),
          }));
        }, projectContext, undefined, (reader) => { readerRef.current = reader; });

        fullResponse = result.text;

        // Update with full content (replaces streaming placeholders)
        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, content: fullResponse } : m
          ),
        }));

        // Check if stopped during streaming
        if (stoppedRef.current) break;

        // Track usage for this API call
        if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
          trackAPICall({
            model: provider.model,
            provider: provider.id,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheCreationTokens: result.usage.cacheCreationTokens,
            cacheReadTokens: result.usage.cacheReadTokens,
          });
        }

        // If no response came through streaming, try getting it from a non-streaming call
        if (!fullResponse) {
          const fallbackResult = await sendMessage(apiMessages, provider, undefined, projectContext);
          fullResponse = fallbackResult.text;

          // Track usage for fallback call
          if (fallbackResult.usage.inputTokens > 0 || fallbackResult.usage.outputTokens > 0) {
            trackAPICall({
              model: provider.model,
              provider: provider.id,
              inputTokens: fallbackResult.usage.inputTokens,
              outputTokens: fallbackResult.usage.outputTokens,
              cacheCreationTokens: fallbackResult.usage.cacheCreationTokens,
              cacheReadTokens: fallbackResult.usage.cacheReadTokens,
            });
          }

          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: fullResponse } : m
            ),
          }));
        }

        // Check if stopped during fallback
        if (stoppedRef.current) break;

        // Check for tool calls in the response
        const parsed = parseToolCalls(fullResponse);

        if (!parsed.hasToolCalls || !projectPath) {
          // No tool calls — we're done
          break;
        }

        // ── Execute tool calls ──────────────────────────────

        const toolNames = parsed.toolCalls.map((tc) => tc.name).join(", ");

        // Add a tool execution status message
        const toolStatusId = (Date.now() + iterations + 1000).toString();
        addMessage({
          id: toolStatusId,
          role: "assistant",
          content: `🔧 Executing: ${toolNames}...`,
          timestamp: new Date(),
        });

        // Check if stopped before executing tools
        if (stoppedRef.current) break;

        // Execute the tools
        const { results, updatedManifest, filesChanged } = await executeToolCalls(
          parsed.toolCalls,
          projectPath,
          currentManifest
        );

        currentManifest = updatedManifest;

        // Update manifest in store if changed
        if (updatedManifest) {
          setManifest(updatedManifest);
        }

        // Refresh file tree if files were changed
        if (filesChanged.length > 0) {
          try {
            const files = await readDirectory(projectPath, 3);
            setFileTree(files);
          } catch {
            // Non-critical, continue
          }
        }

        // Update tool status message with results
        const toolResultsSummary = results
          .map((r) => r.success ? r.result.split("\n")[0] : `❌ ${r.result}`)
          .join("\n");

        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === toolStatusId ? { ...m, content: `🔧 ${toolResultsSummary}` } : m
          ),
        }));

        // Check if stopped after tool execution
        if (stoppedRef.current) break;

        // Build the tool results message and add to conversation
        const toolResultsMessage = formatToolResults(results);

        // Add the full exchange to API messages for context
        apiMessages = [
          ...apiMessages,
          { role: "assistant" as const, content: fullResponse },
          { role: "user" as const, content: toolResultsMessage },
        ];

        // Update project context with new manifest
        if (currentManifest) {
          projectContext = {
            path: projectPath,
            manifest: currentManifest,
          };
        }

        // Continue the loop — AI will process tool results
      }

      if (iterations >= MAX_TOOL_ITERATIONS) {
        addMessage({
          id: (Date.now() + 9999).toString(),
          role: "assistant",
          content: "⚠️ Reached maximum tool iterations. Please continue with a follow-up message.",
          timestamp: new Date(),
        });
      }

    } catch (error: any) {
      if (stoppedRef.current) {
        // User stopped — don't show error
      } else {
        console.error("Chat error:", error);
        useChatStore.setState((state) => ({
          messages: state.messages.filter((m) => m.content && m.content !== "").concat({
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `❌ Error: ${error.message}`,
            timestamp: new Date(),
          }),
        }));
      }
    } finally {
      stoppedRef.current = false;
      readerRef.current = null;
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle paste on the input field specifically
  const handleInputPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        hasImage = true;
        break;
      }
    }

    if (!hasImage) return;

    e.preventDefault();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          const img = await blobToMessageImage(blob, item.type);
          if (img) {
            setPendingImages((prev) => [...prev, img]);
          }
        }
      }
    }
  }, [blobToMessageImage]);

  const handleEditMessage = (messageId: string) => {
    if (isLoading) return;
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    // Put message content back in the input
    setInput(message.content);

    // Restore images if any
    if (message.images && message.images.length > 0) {
      setPendingImages(message.images);
    }

    // Remove this message and everything after it
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    useChatStore.setState((state) => ({
      messages: state.messages.slice(0, messageIndex),
    }));

    // Focus input
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSaveCodeBlock = async (code: string, filename: string) => {
    if (!projectPath) return;
    
    try {
      const fullPath = `${projectPath}\\${filename.replace(/\//g, "\\")}`;
      await writeFile(fullPath, code);
      
      // Refresh file tree
      const files = await readDirectory(projectPath, 3);
      setFileTree(files);

      // Update manifest with the new/modified file
      if (manifest) {
        const relativePath = getRelativePath(projectPath, fullPath);
        const updatedManifest = updateManifestEntry(manifest, relativePath, code);
        setManifest(updatedManifest);
      }

      addMessage({
        id: Date.now().toString(),
        role: "assistant",
        content: `✅ Saved: ${filename}`,
        timestamp: new Date(),
      });
    } catch (error: any) {
      addMessage({
        id: Date.now().toString(),
        role: "assistant",
        content: `❌ Failed to save: ${error.message}`,
        timestamp: new Date(),
      });
    }
  };

  // Parse message for code blocks and tool call blocks
  const renderMessage = (content: string) => {
    // Strip tool_call blocks from display — show clean text only
    const cleanContent = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    if (!cleanContent) return <span className={`${t.colors.textMuted} italic`}>Working with files...</span>;

    const parts = cleanContent.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.slice(3, -3).split("\n");
        const language = lines[0]?.trim() || "";
        const codeLines = language ? lines.slice(1) : lines;
        const code = codeLines.join("\n").trim();
        
        // Try to detect filename from comment
        let filename = "";
        const filenameMatch = code.match(/^\/\/\s*filename:\s*(.+)/m) || 
                              code.match(/^<!--\s*filename:\s*(.+?)\s*-->/m) ||
                              code.match(/^#\s*filename:\s*(.+)/m);
        if (filenameMatch) {
          filename = filenameMatch[1].trim();
        }

        return (
          <div key={index} className={`my-2 ${t.colors.bgTertiary} ${t.borderRadius} overflow-hidden`}>
            <div className={`flex justify-between items-center px-3 py-1 ${t.colors.bgSecondary}`}>
              <span className={`text-xs ${t.colors.textMuted}`}>{language || "code"}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => navigator.clipboard.writeText(code)}
                  className={`text-xs px-2 py-1 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text}`}
                >
                  Copy
                </button>
                {projectPath && (
                  <button
                    onClick={() => {
                      if (filename) {
                        handleSaveCodeBlock(code, filename);
                      } else {
                        const name = prompt("Save as (e.g., index.html):");
                        if (name) handleSaveCodeBlock(code, name);
                      }
                    }}
                    className={`text-xs px-2 py-1 ${t.borderRadius} flex items-center gap-1 ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`}
                  >
                    <Save size={12} />
                    {filename ? `Save ${filename}` : "Save to file"}
                  </button>
                )}
              </div>
            </div>
            <pre className={`p-3 text-sm overflow-x-auto select-text ${t.colors.text}`} style={{ fontFamily: "monospace" }}>
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      
      return part ? (
        <span key={index} className="whitespace-pre-wrap">{part}</span>
      ) : null;
    });
  };

  // Render images attached to a message
  const renderMessageImages = (images: MessageImage[]) => {
    return (
      <div className="flex flex-wrap gap-2 mb-2">
        {images.map((img) => (
          <img
            key={img.id}
            src={`data:${img.mimeType};base64,${img.base64}`}
            alt={img.name || "Attached image"}
            className={`max-w-[240px] max-h-[180px] object-contain ${t.borderRadius} cursor-pointer hover:opacity-90 transition-opacity`}
            onClick={() => {
              const win = window.open();
              if (win) {
                win.document.write(`<img src="data:${img.mimeType};base64,${img.base64}" style="max-width:100%;height:auto;" />`);
                win.document.title = img.name || "Image";
              }
            }}
          />
        ))}
      </div>
    );
  };

  // Detect tool status messages (🔧 prefix)
  const isToolMessage = (content: string) => content.startsWith("🔧");

  return (
    <div
      className={`flex flex-col h-full ${t.colors.bg} relative`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Image size={40} className="text-blue-500" />
            <span className={`text-sm font-medium ${t.colors.text}`}>Drop image here</span>
          </div>
        </div>
      )}

      {/* Chat header */}
      <div className={`px-4 py-2 ${t.colors.bgSecondary} ${t.colors.border} border-b flex justify-between items-center`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSettingsClick?.("apikey")}
            className={`text-sm ${t.colors.textMuted} hover:${t.colors.text} cursor-pointer transition-colors`}
            title="Change AI provider"
          >
            {getActiveProviderDisplay()} ⚙
          </button>
          {projectPath && (
            <span className={`text-xs px-2 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius} ${t.colors.textMuted}`}>
              📁 {projectPath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Session cost indicator */}
          {session.totalCost > 0 && (
            <button
              onClick={() => onSettingsClick?.("usage")}
              className={`flex items-center gap-1.5 px-2 py-0.5 ${t.borderRadius} ${t.colors.bgTertiary} hover:opacity-80 transition-opacity`}
              title="Session usage — click for details"
            >
              <Coins size={13} className="text-amber-500" />
              <span className={`text-xs font-medium ${t.colors.text}`}>
                {formatCost(session.totalCost)}
              </span>
              <span className={`text-xs ${t.colors.textMuted}`}>
                · {session.entries.length} {session.entries.length === 1 ? "call" : "calls"}
              </span>
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} ${t.borderRadius}`}
              title="Clear chat"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        {messages.length === 0 ? (
          <div className={`${t.colors.textMuted} text-center mt-8 ${t.fontFamily}`}>
            {projectPath 
              ? `Project loaded: ${projectPath.split(/[/\\]/).pop()}. Ask me to create or edit files!`
              : "Start a conversation, or open a project first..."
            }
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isTool = message.role === "assistant" && isToolMessage(message.content);

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 group ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" && (
                    <div className={`w-8 h-8 ${isTool ? t.colors.bgTertiary : t.colors.accent} ${t.borderRadius} flex items-center justify-center flex-shrink-0`}>
                      {isTool 
                        ? <Wrench size={16} className={t.colors.textMuted} />
                        : <Bot size={18} className={theme === "highContrast" ? "text-black" : "text-white"} />
                      }
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-2 break-words overflow-hidden ${t.borderRadius} ${
                      message.role === "user"
                        ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                        : isTool
                        ? `${t.colors.bgTertiary} ${t.colors.textMuted} text-sm`
                        : `${t.colors.bgSecondary} ${t.colors.text}`
                    }`}
                  >
                    {/* Render images if attached */}
                    {message.images && message.images.length > 0 && renderMessageImages(message.images)}
                    
                    <div className={`${t.fontFamily}`}>
                      {message.content 
                        ? (message.role === "assistant" && !isTool ? renderMessage(message.content) : message.content)
                        : message.images && message.images.length > 0 
                          ? null
                          : "Thinking..."}
                    </div>
                    <div className={`text-[10px] mt-1 opacity-50 ${
                      message.role === "user" ? "text-right" : ""
                    }`}>
                      {new Date(message.timestamp).toLocaleTimeString([], { 
                        hour: "2-digit", 
                        minute: "2-digit",
                        hour12: timeFormat === "12h",
                      })}
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-8 h-8 ${t.colors.bgTertiary} ${t.borderRadius} flex items-center justify-center`}>
                        <User size={18} className={t.colors.text} />
                      </div>
                      <button
                        onClick={() => handleEditMessage(message.id)}
                        className={`${t.colors.textMuted} hover:${t.colors.text} opacity-0 group-hover:opacity-100 transition-opacity`}
                        title="Edit message"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4">
        {/* Pending image chips */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingImages.map((img) => (
              <div
                key={img.id}
                className={`relative group/chip inline-flex items-center gap-1.5 px-2 py-1 ${t.borderRadius} ${t.colors.bgTertiary} border ${t.colors.border}`}
              >
                <img
                  src={`data:${img.mimeType};base64,${img.base64}`}
                  alt={img.name || "Image"}
                  className="w-8 h-8 object-cover rounded"
                />
                <span className={`text-xs ${t.colors.textMuted} max-w-[100px] truncate`}>
                  {img.name || "Image"}
                </span>
                <button
                  onClick={() => removeImage(img.id)}
                  className={`ml-0.5 p-0.5 ${t.borderRadius} hover:bg-red-500/20 text-red-400 hover:text-red-500 transition-colors`}
                  title="Remove image"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handleInputPaste}
            placeholder={
              isLoading
                ? "Waiting for response..."
                : pendingImages.length > 0
                  ? "Add a message or just send the image..."
                  : "Type a message... (paste images with Ctrl+V)"
            }
            disabled={isLoading}
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily} disabled:opacity-50`}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className={`bg-red-600 hover:bg-red-700 text-white px-4 py-2 ${t.borderRadius} flex items-center gap-2`}
              title="Stop generating"
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && pendingImages.length === 0}
              className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 ${t.borderRadius} flex items-center gap-2 disabled:opacity-50`}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatArea;