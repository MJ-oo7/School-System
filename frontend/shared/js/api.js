window.API_BASE = window.API_BASE || "http://127.0.0.1:8000";

// Apply persisted Light/Dark theme before paint
(function initSavedTheme() {
    const saved = localStorage.getItem("portal_theme") || "dark";
    const root = document.documentElement;
    if (saved === "light") {
        root.classList.remove("dark");
        root.classList.add("light");
    } else {
        root.classList.add("dark");
        root.classList.remove("light");
    }
})();

window.togglePortalTheme = function () {
    const root = document.documentElement;
    const isDark = root.classList.contains("dark");
    if (isDark) {
        root.classList.remove("dark");
        root.classList.add("light");
        localStorage.setItem("portal_theme", "light");
    } else {
        root.classList.add("dark");
        root.classList.remove("light");
        localStorage.setItem("portal_theme", "dark");
    }
    window.syncThemeToggleButtons();
};

window.syncThemeToggleButtons = function () {
    const isDark = document.documentElement.classList.contains("dark");
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
        const icon = btn.querySelector("[data-theme-icon]");
        const label = btn.querySelector("[data-theme-label]");
        if (icon) {
            icon.textContent = isDark ? "light_mode" : "dark_mode";
        }
        if (label) {
            label.textContent = isDark ? "Light Mode" : "Dark Mode";
        }
    });
};

window.addEventListener("DOMContentLoaded", () => {
    window.syncThemeToggleButtons();
});

if (typeof tailwind !== "undefined") {
    tailwind.config = {
        darkMode: "class",
        theme: {
            extend: {
                colors: {
                    "surface": "var(--surface)",
                    "surface-dim": "var(--surface-dim)",
                    "surface-bright": "var(--surface-bright)",
                    "surface-container-lowest": "var(--surface-container-lowest)",
                    "surface-container-low": "var(--surface-container-low)",
                    "surface-container": "var(--surface-container)",
                    "surface-container-high": "var(--surface-container-high)",
                    "surface-container-highest": "var(--surface-container-highest)",
                    "background": "var(--surface)",
                    "on-background": "var(--on-surface)",
                    "on-surface": "var(--on-surface)",
                    "on-surface-variant": "var(--on-surface-variant)",
                    "outline": "var(--outline)",
                    "outline-variant": "var(--outline-variant)",
                    "surface-variant": "var(--surface-container-highest)",
                    "surface-tint": "var(--primary)",
                    "primary": "var(--primary)",
                    "on-primary": "var(--on-primary)",
                    "primary-container": "var(--primary-container)",
                    "on-primary-container": "var(--on-primary-container)",
                    "primary-fixed": "var(--primary-fixed)",
                    "primary-fixed-dim": "var(--primary-fixed-dim)",
                    "secondary": "var(--secondary)",
                    "on-secondary": "var(--on-secondary)",
                    "secondary-container": "var(--secondary-container)",
                    "on-secondary-container": "var(--on-secondary-container)",
                    "secondary-fixed": "var(--secondary-fixed)",
                    "secondary-fixed-dim": "var(--secondary-fixed-dim)",
                    "tertiary": "var(--tertiary)",
                    "on-tertiary": "var(--on-tertiary)",
                    "tertiary-fixed": "var(--tertiary-fixed)",
                    "tertiary-fixed-dim": "var(--tertiary-fixed-dim)",
                    "error": "var(--error)",
                    "error-container": "var(--error-container)",
                    "on-error-container": "var(--on-error-container)"
                },
                borderRadius: {
                    DEFAULT: "0.25rem",
                    lg: "0.5rem",
                    xl: "0.75rem",
                    full: "9999px"
                },
                spacing: {
                    "space-xl": "2.5rem",
                    "margin-md": "2rem",
                    "margin": "1.5rem",
                    "gutter-md": "1.5rem",
                    "margin-lg": "3rem",
                    "space-xs": "0.25rem",
                    "space-sm": "0.5rem",
                    "space-lg": "1.5rem",
                    "gutter-lg": "2rem",
                    "gutter": "1rem",
                    "space-md": "1rem"
                },
                fontFamily: {
                    "headline-sm": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "metric-num": ["JetBrains Mono", "monospace"],
                    "body-lg": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "headline-xl": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "label-caps": ["JetBrains Mono", "monospace"],
                    "label-sm": ["JetBrains Mono", "monospace"],
                    "label-md": ["JetBrains Mono", "monospace"],
                    "body-md": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "body-sm": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "headline-md": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "label-code": ["JetBrains Mono", "monospace"],
                    "display-lg": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "headline-xl-mobile": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "display-lg-mobile": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "headline-lg": ["Hanken Grotesk", "Inter", "sans-serif"],
                    "caption": ["Hanken Grotesk", "Inter", "sans-serif"]
                },
                fontSize: {
                    "headline-sm": ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.01em", fontWeight: "600" }],
                    "metric-num": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em", fontWeight: "700" }],
                    "body-lg": ["1.125rem", { lineHeight: "1.75rem", fontWeight: "400" }],
                    "headline-xl": ["2.25rem", { lineHeight: "2.75rem", letterSpacing: "-0.025em", fontWeight: "700" }],
                    "label-caps": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.08em", fontWeight: "600" }],
                    "label-sm": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em", fontWeight: "500" }],
                    "label-md": ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "0.02em", fontWeight: "500" }],
                    "body-md": ["0.9375rem", { lineHeight: "1.5rem", fontWeight: "400" }],
                    "body-sm": ["0.8125rem", { lineHeight: "1.25rem", fontWeight: "400" }],
                    "headline-md": ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em", fontWeight: "600" }],
                    "label-code": ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "0.02em", fontWeight: "500" }],
                    "display-lg": ["3rem", { lineHeight: "3.5rem", letterSpacing: "-0.03em", fontWeight: "700" }],
                    "headline-xl-mobile": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em", fontWeight: "700" }],
                    "display-lg-mobile": ["2rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em", fontWeight: "700" }],
                    "headline-lg": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em", fontWeight: "600" }],
                    "caption": ["0.75rem", { lineHeight: "1.2rem", fontWeight: "400" }]
                }
            }
        }
    };
}
