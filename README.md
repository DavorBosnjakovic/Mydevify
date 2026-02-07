# Mydevify

**AI-powered desktop app for building, managing, and deploying web projects — without needing to know code.**

Mydevify is a desktop application that lets anyone build real web projects through natural conversation with AI. It handles the code, the files, the deployments — you just describe what you want.

![Status](https://img.shields.io/badge/status-in%20development-orange)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-proprietary-red)

---

## Features

### 🤖 AI-Powered Development
- Chat with AI to build, modify, and manage your projects
- Vision support — drop in screenshots or mockups
- Automatic file creation, editing, and deletion
- Smart project manifest for efficient context management

### 🎨 Dual Mode Interface
- **Simple Mode** — clean, non-technical view for beginners
- **Technical Mode** — full access to terminal, git status, and code details

### ⏱️ Time Machine
- Automatic snapshots before every file change
- One-click restore to any previous version
- Filter history by file
- Every restore is undoable

### 🔗 Connections Hub
- Connect to GitHub, Vercel, Supabase, Cloudflare, Stripe, Netlify, SendGrid, and Namecheap
- AI uses your connected services directly through a meta-tool pattern
- Token-based authentication with status indicators

### 💻 Built-in Terminal
- Full terminal access in Technical mode
- Themed to match your chosen app theme
- Command history with arrow key navigation

### 🎭 6 Themes
Dark, Light, Sepia, Retro, Midnight, High Contrast

### 📊 Usage Tracking
- Token and cost tracking (input/output split)
- Session, monthly, and all-time views
- Budget alerts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2.0](https://tauri.app/) (Rust backend) |
| Frontend | React + TypeScript |
| Bundler | [Vite](https://vitejs.dev/) |
| Styling | [Tailwind CSS v3](https://tailwindcss.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Terminal | [xterm.js](https://xtermjs.org/) |
| Local AI | [Ollama](https://ollama.ai/) (llama3.1:8b) |

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Ollama](https://ollama.ai/) (for local AI)
- Tauri CLI: `cargo install tauri-cli`

## Getting Started

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/mydevify.git
cd mydevify

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
app/
├── src/                          # React frontend
│   ├── components/               # UI components
│   │   ├── layout/               # Main layout + dividers
│   │   ├── topbar/               # Top bar, git status, usage
│   │   ├── sidebar/              # Project list, file tree
│   │   ├── chat/                 # Chat interface + usage indicator
│   │   ├── preview/              # Live preview + file viewer
│   │   ├── terminal/             # xterm.js terminal
│   │   ├── timemachine/          # Snapshot restore UI
│   │   └── settings/             # All settings panels
│   ├── stores/                   # Zustand state management
│   ├── services/                 # AI, file ops, tools, connections
│   └── config/                   # Theme definitions
├── src-tauri/                    # Rust backend
│   └── src/                      # Tauri commands, preview server
├── index.html
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

---

## Contributing

This project is currently in private development. Contribution guidelines will be added when the project opens up.

## License

Proprietary — All rights reserved.

---

**Built with ❤️ by the Mydevify team**