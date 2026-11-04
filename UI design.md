 the UI, design system, animations, and effects that power your index.html landing page.

🎨 1. Core Design System & Color Palette
The platform uses a "Dark Campus Tech" aesthetic, characterized by a deep dark background with vibrant, futuristic accents.

Backgrounds: Deep space black (#07090F) transitioning to dark surface tiles (#121826).
Accents: A striking gradient mix of Neon Blue (#00E5FF) and Neon Green (#00FF7F).
Typography: The bold and geometric 'Syne' font for headings (gives a very modern/tech feel), combined with 'DM Sans' for highly readable body text.
Glassmorphism Cards: Cards (.card) use a semi-transparent dark background (rgba(18, 24, 38, 0.6)) coupled with a backdrop blur (backdrop-filter: blur(12px)), giving them a frosted-glass feel.
✨ 2. Key UI Components & Layouts
Navbar: Fixed and transparent at the top. The logo features a custom SVG with a blue-to-green gradient. It incorporates secondary "Ghost" buttons (transparent until hovered) and a bold "Primary" Sign Up button.
Hero Section: Centers a massive title featuring a text-gradient overlay (background: linear-gradient(to right, #FFFFFF, #94A3B8)).
Icon Wrappers: Soft, semi-transparent colored square blocks surrounding Phosphor Icons (e.g., blue for Intro cards, green for Feature tiles).
Timeline Element: The "How it Works" section utilizes a vertical timeline structure, featuring glowing numbered circles connected by a subtle vertical border line.
🎬 3. Animations & Micro-Interactions
The page feels "alive" due to several CSS and JavaScript animations:

Background Pulse (bgPulse): The hero section has a subtle background mesh (blue and green radial gradients) that slowly scales and fades in and out over a 10-second infinite loop.
Hero Fade Up (fadeUp): When the page loads, the main hero text smoothly slides up 30px and fades in over 1 second.
Bouncing Scroll Indicator (bounce): A small chevron at the bottom of the hero section continuously bounces to prompt the user to scroll down.
Dynamic Number Counters (JS): As you scroll down to the "Mission" section, the statistics (like "500+", "200+") animate dynamically, counting up from zero to their target values using an IntersectionObserver.
Interactive Cards (Hover): When you hover over any card, it elegantly floats upward (transform: translateY(-4px)), its border glows with a blue highlight, and it projects a neon shadow (var(--glow-accent)).
Playful Icon Hover: When hovering over the "About" cards (Intro grid), the icon background flips to solid blue, the icon turns dark, and the icon physically rotates 5 degrees (transform: scale(1.1) rotate(5deg)).