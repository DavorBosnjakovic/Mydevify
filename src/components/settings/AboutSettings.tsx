import { ExternalLink, Download, Github, MessageCircle } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function AboutSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-6">About Mydevify</h1>

      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-16 h-16 ${t.colors.accent} ${t.borderRadius} flex items-center justify-center text-2xl font-bold ${theme === "highContrast" ? "text-black" : "text-white"}`}>
            M
          </div>
          <div>
            <h2 className="text-xl font-semibold">Mydevify</h2>
            <p className={`${t.colors.textMuted}`}>AI-Powered Development Platform</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className={`text-sm ${t.colors.textMuted}`}>Version</p>
            <p className="font-medium">1.0.0</p>
          </div>
          <div>
            <p className={`text-sm ${t.colors.textMuted}`}>Status</p>
            <p className="font-medium text-green-500">Up to date</p>
          </div>
        </div>
      </div>

      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Resources</h3>
      <div className="space-y-2 mb-6">
        <a href="#" className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center gap-3 hover:opacity-80`}>
          <ExternalLink size={18} />
          <span>Documentation</span>
        </a>
        <a href="#" className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center gap-3 hover:opacity-80`}>
          <Github size={18} />
          <span>GitHub Repository</span>
        </a>
        <a href="#" className={`${t.colors.bgSecondary} ${t.borderRadius} p-3 flex items-center gap-3 hover:opacity-80`}>
          <MessageCircle size={18} />
          <span>Community Discord</span>
        </a>
      </div>

      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Support</h3>
      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <p className="mb-3">Need help? We're here for you.</p>
        <div className="flex gap-2">
          <button className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 ${t.borderRadius}`}>
            Contact Support
          </button>
          <button className={`${t.colors.bgTertiary} hover:opacity-80 px-4 py-2 ${t.borderRadius}`}>
            Report a Bug
          </button>
        </div>
      </div>

      <div className={`text-sm ${t.colors.textMuted}`}>
        <a href="#" className="hover:underline">Terms of Service</a>
        {" · "}
        <a href="#" className="hover:underline">Privacy Policy</a>
        {" · "}
        <a href="#" className="hover:underline">Licenses</a>
      </div>

      <p className={`text-sm ${t.colors.textMuted} mt-4`}>© 2026 Mydevify. All rights reserved.</p>
    </div>
  );
}

export default AboutSettings;