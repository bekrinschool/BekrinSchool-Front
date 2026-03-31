/** @type {import('tailwindcss').Config} */
const config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2563EB",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "#F3F4F6",
          foreground: "#6B7280",
        },
        danger: "#EF4444",
      },
      borderRadius: {
        xl: "1rem",
      },
    },
  },
  plugins: [],
};

export default config;

