import { create } from "zustand";
import { FileEntry } from "../services/fileService";
import { ProjectManifest } from "../services/manifestService";

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  projectPath: string | null;
  fileTree: FileEntry[];
  selectedFile: FileEntry | null;
  manifest: ProjectManifest | null;
  setCurrentProject: (project: Project | null) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setProjectPath: (path: string | null) => void;
  setFileTree: (tree: FileEntry[]) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  setManifest: (manifest: ProjectManifest | null) => void;
}

// Load projects from localStorage
const loadProjects = (): Project[] => {
  try {
    const saved = localStorage.getItem("mydevify-projects");
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.projects || parsed.state?.projects || [];
    }
  } catch (e) {
    console.error("Failed to load projects:", e);
  }
  return [];
};

// Save projects to localStorage
const saveProjects = (projects: Project[]) => {
  localStorage.setItem("mydevify-projects", JSON.stringify({ projects }));
};

export const useProjectStore = create<ProjectState>((set) => ({
  projects: loadProjects(),
  currentProject: null,
  projectPath: null,
  fileTree: [],
  selectedFile: null,
  manifest: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  addProject: (project) =>
    set((state) => {
      const newProjects = [...state.projects, project];
      saveProjects(newProjects);
      return { projects: newProjects };
    }),
  removeProject: (id) =>
    set((state) => {
      const newProjects = state.projects.filter((p) => p.id !== id);
      saveProjects(newProjects);
      return { projects: newProjects };
    }),
  setProjectPath: (path) => set({ projectPath: path }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setManifest: (manifest) => set({ manifest: manifest }),
}));