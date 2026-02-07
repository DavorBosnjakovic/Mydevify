import { Check } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

function BillingSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const currentPlan = "starter";

  const plans = [
    {
      id: "starter",
      name: "Starter",
      price: 49,
      description: "For individuals",
      features: [
        "Desktop app (Mac, Windows, Linux)",
        "Unlimited projects",
        "All features",
        "Voice input",
        "All integrations",
        "Email support",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      price: 149,
      description: "For teams & agencies",
      features: [
        "Everything in Starter",
        "~1M tokens/month included",
        "5 team seats",
        "Collaboration features",
        "Priority support",
        "Project templates",
      ],
    },
    {
      id: "business",
      name: "Business",
      price: 299,
      description: "For companies",
      features: [
        "Everything in Pro",
        "~3M tokens/month included",
        "15 team seats",
        "Admin controls",
        "SSO integration",
        "Dedicated support",
      ],
    },
  ];

  return (
    <div className={`${t.colors.text}`}>
      <h1 className="text-2xl font-bold mb-2">Billing</h1>
      <p className={`${t.colors.textMuted} mb-6`}>
        Manage your subscription and payment details.
      </p>

      {/* Current plan */}
      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 mb-6`}>
        <div className="flex justify-between items-center">
          <div>
            <p className={`text-sm ${t.colors.textMuted}`}>Current Plan</p>
            <p className="text-xl font-semibold">Starter</p>
          </div>
          <div className="text-right">
            <p className={`text-sm ${t.colors.textMuted}`}>Next billing date</p>
            <p className="font-medium">March 4, 2026</p>
          </div>
        </div>
      </div>

      {/* Plans */}
      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Available Plans</h3>
      <div className="grid gap-4 mb-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 ${
              currentPlan === plan.id ? `${t.colors.border} border-2` : ""
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-lg font-semibold">{plan.name}</h4>
                  {currentPlan === plan.id && (
                    <span className={`text-xs px-2 py-0.5 ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} ${t.borderRadius}`}>
                      Current
                    </span>
                  )}
                </div>
                <p className={`text-sm ${t.colors.textMuted}`}>{plan.description}</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold">${plan.price}</span>
                <span className={`text-sm ${t.colors.textMuted}`}>/month</span>
              </div>
            </div>

            <ul className="space-y-1 mb-4">
              {plan.features.map((feature, i) => (
                <li key={i} className={`text-sm flex items-center gap-2 ${t.colors.textMuted}`}>
                  <Check size={14} className="text-green-500" />
                  {feature}
                </li>
              ))}
            </ul>

            {currentPlan !== plan.id && (
              <button
                className={`w-full ${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} py-2 ${t.borderRadius}`}
              >
                {plans.findIndex(p => p.id === plan.id) > plans.findIndex(p => p.id === currentPlan)
                  ? "Upgrade"
                  : "Downgrade"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Payment method */}
      <h3 className={`text-sm font-medium mb-3 ${t.colors.textMuted}`}>Payment Method</h3>
      <div className={`${t.colors.bgSecondary} ${t.borderRadius} p-4 flex justify-between items-center`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">💳</span>
          <div>
            <p className="font-medium">•••• •••• •••• 4242</p>
            <p className={`text-sm ${t.colors.textMuted}`}>Expires 12/28</p>
          </div>
        </div>
        <button className={`${t.colors.bgTertiary} hover:opacity-80 px-3 py-1 ${t.borderRadius} text-sm`}>
          Update
        </button>
      </div>
    </div>
  );
}

export default BillingSettings;