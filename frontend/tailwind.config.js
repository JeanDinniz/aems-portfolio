/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        "./index.html",
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
    ],
    prefix: "",
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            colors: {
                brand: {
                    amber: '#F5A800',
                    'amber-hover': '#FFB800',
                    'amber-dim': 'rgba(245, 168, 0, 0.12)',
                    black: '#1A1A1A',
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // AEMS Colors
                aems: {
                    primary: {
                        50: "var(--aems-primary-50)",
                        100: "var(--aems-primary-100)",
                        200: "var(--aems-primary-200)",
                        300: "var(--aems-primary-300)",
                        400: "var(--aems-primary-400)",
                        500: "var(--aems-primary-500)",
                        600: "var(--aems-primary-600)",
                        700: "var(--aems-primary-700)",
                        800: "var(--aems-primary-800)",
                        900: "var(--aems-primary-900)",
                    },
                    neutral: {
                        50: "var(--aems-neutral-50)",
                        100: "var(--aems-neutral-100)",
                        150: "var(--aems-neutral-150)",
                        200: "var(--aems-neutral-200)",
                        300: "var(--aems-neutral-300)",
                        400: "var(--aems-neutral-400)",
                        500: "var(--aems-neutral-500)",
                        600: "var(--aems-neutral-600)",
                        700: "var(--aems-neutral-700)",
                        800: "var(--aems-neutral-800)",
                        900: "var(--aems-neutral-900)",
                        950: "var(--aems-neutral-950)",
                    },
                    success: {
                        DEFAULT: "var(--aems-success)",
                        light: "var(--aems-success-light)",
                    },
                    warning: {
                        DEFAULT: "var(--aems-warning)",
                        light: "var(--aems-warning-light)",
                    },
                    error: {
                        DEFAULT: "var(--aems-error)",
                        light: "var(--aems-error-light)",
                    },
                    info: {
                        DEFAULT: "var(--aems-info)",
                        light: "var(--aems-info-light)",
                    },
                },
            },
            fontFamily: {
                sans: ["var(--aems-font)", "sans-serif"],
                mono: ["var(--aems-font-mono)", "monospace"],
                display: ['Barlow', 'Barlow Semi Condensed', 'sans-serif'],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                'aems-sm': "var(--aems-radius-sm)",
                'aems': "var(--aems-radius)",
                'aems-lg': "var(--aems-radius-lg)",
                'aems-xl': "var(--aems-radius-xl)",
            },
            boxShadow: {
                'aems-sm': "var(--aems-shadow-sm)",
                'aems-md': "var(--aems-shadow-md)",
                'aems-lg': "var(--aems-shadow-lg)",
                'aems-glow': "var(--aems-shadow-glow)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
}
