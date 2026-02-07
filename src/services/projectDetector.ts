import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────

export type ProjectType = "static" | "framework" | "non-web";

export interface ProjectDetection {
  type: ProjectType;
  framework: string | null;
  devCommand: string | null;
  installCommand: string | null;
  portPattern: RegExp | null;
  needsInstall: boolean;
}

// ── Framework Detection Map ───────────────────────────────────

interface FrameworkInfo {
  name: string;
  devCommand: string;
  portPattern: RegExp;
}

const FRAMEWORK_MAP: { pkg: string; info: FrameworkInfo }[] = [
  {
    pkg: "next",
    info: {
      name: "Next.js",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "nuxt",
    info: {
      name: "Nuxt",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@sveltejs/kit",
    info: {
      name: "SvelteKit",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "svelte",
    info: {
      name: "Svelte",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "astro",
    info: {
      name: "Astro",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "vite",
    info: {
      name: "Vite",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "react-scripts",
    info: {
      name: "Create React App",
      devCommand: "npm start",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "@angular/cli",
    info: {
      name: "Angular",
      devCommand: "npm start",
      portPattern: /localhost:(\d+)/,
    },
  },
  {
    pkg: "vue",
    info: {
      name: "Vue",
      devCommand: "npm run dev",
      portPattern: /localhost:(\d+)/,
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────

function detectPackageManager(rootFileNames: string[]): string {
  if (rootFileNames.includes("pnpm-lock.yaml")) return "pnpm";
  if (rootFileNames.includes("yarn.lock")) return "yarn";
  return "npm";
}

function getInstallCommand(manager: string): string {
  switch (manager) {
    case "pnpm": return "pnpm install";
    case "yarn": return "yarn install";
    default: return "npm install";
  }
}

function getDevCommand(manager: string, defaultCmd: string): string {
  if (manager === "npm") return defaultCmd;
  return defaultCmd.replace(/^npm /, `${manager} `);
}

async function checkNodeModules(projectPath: string): Promise<boolean> {
  try {
    await invoke<string>("resolve_path", {
      cwd: projectPath,
      target: "node_modules",
    });
    return true;
  } catch {
    return false;
  }
}

// ── Main Detection Function ───────────────────────────────────

const NON_WEB: ProjectDetection = {
  type: "non-web",
  framework: null,
  devCommand: null,
  installCommand: null,
  portPattern: null,
  needsInstall: false,
};

export async function detectProjectType(projectPath: string): Promise<ProjectDetection> {
  console.log("[detector] Starting detection for:", projectPath);

  // Ensure Rust backend knows the project path
  try {
    await invoke("set_project_path", { path: projectPath });
    console.log("[detector] set_project_path OK");
  } catch (err) {
    console.warn("[detector] set_project_path failed:", err);
  }

  // List root directory
  let rootEntries: { name: string; path: string; is_dir: boolean }[] = [];
  try {
    rootEntries = await invoke("read_directory", { path: projectPath, depth: 0 });
    console.log("[detector] Root entries:", rootEntries.map((e) => e.name));
  } catch (err) {
    console.warn("[detector] read_directory failed:", err);
    return NON_WEB;
  }

  const rootFileNames = rootEntries.map((e) => e.name);
  const hasIndexHtml = rootFileNames.includes("index.html");
  const hasPackageJson = rootFileNames.includes("package.json");

  console.log("[detector] hasIndexHtml:", hasIndexHtml, "hasPackageJson:", hasPackageJson);

  // 1. Has index.html but NO package.json → pure static
  if (hasIndexHtml && !hasPackageJson) {
    console.log("[detector] → static (index.html, no package.json)");
    return {
      type: "static",
      framework: null,
      devCommand: null,
      installCommand: null,
      portPattern: null,
      needsInstall: false,
    };
  }

  // 2. Has package.json → read it and check for known frameworks
  if (hasPackageJson) {
    const pkgEntry = rootEntries.find((e) => e.name === "package.json");
    console.log("[detector] package.json entry:", pkgEntry);

    let packageJson: any = null;
    if (pkgEntry) {
      try {
        const raw: string = await invoke("read_file", { path: pkgEntry.path });
        console.log("[detector] package.json read OK, length:", raw.length);
        packageJson = JSON.parse(raw);
      } catch (err) {
        console.warn("[detector] Failed to read/parse package.json:", err);
      }
    }

    if (packageJson) {
      const allDeps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      const depNames = Object.keys(allDeps);
      console.log("[detector] Dependencies found:", depNames);

      for (const { pkg, info } of FRAMEWORK_MAP) {
        if (allDeps[pkg]) {
          const manager = detectPackageManager(rootFileNames);
          const hasModules = await checkNodeModules(projectPath);
          console.log("[detector] → framework:", info.name, "manager:", manager, "hasModules:", hasModules);

          return {
            type: "framework",
            framework: info.name,
            devCommand: getDevCommand(manager, info.devCommand),
            installCommand: getInstallCommand(manager),
            portPattern: info.portPattern,
            needsInstall: !hasModules,
          };
        }
      }

      console.log("[detector] package.json found but no known framework in deps");
    } else {
      console.log("[detector] packageJson is null (read or parse failed)");
    }

    if (hasIndexHtml) {
      console.log("[detector] → static (has index.html + unrecognized package.json)");
      return {
        type: "static",
        framework: null,
        devCommand: null,
        installCommand: null,
        portPattern: null,
        needsInstall: false,
      };
    }

    console.log("[detector] → non-web (package.json but no framework, no index.html)");
    return NON_WEB;
  }

  // 3. No index.html, no package.json → non-web
  console.log("[detector] → non-web (no index.html, no package.json)");
  return NON_WEB;
}