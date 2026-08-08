import type { FileNode, Project } from "./types";

/**
 * Realistic demo workspace. Everything here is clearly-labelled sample data
 * used only in Demo Mode — it is never presented as real filesystem output.
 */

const motionBefore = `import { useEffect, useRef } from "react";

const EASE = "cubic-bezier(0.5, 0, 1, 1)";

export function useReveal(delay = 0) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Runs before layout is measured, so height is still 0.
    el.animate(
      [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1 }],
      { duration: 1200, delay, easing: EASE }
    );
  }, [delay]);

  return ref;
}
`;

const motionAfter = `import { useEffect, useRef } from "react";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function useReveal(delay = 0) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.animate(
        [
          { opacity: 0, transform: "translateY(24px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 420, delay, easing: EASE, fill: "both" }
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [delay]);

  return ref;
}
`;

const heroBefore = `import { useReveal } from "../motion/useReveal";

export function Hero() {
  const ref = useReveal(600);

  return (
    <section ref={ref} className="hero" style={{ transition: "all 1.2s linear" }}>
      <h1>Aurora</h1>
      <p>Design systems that move.</p>
    </section>
  );
}
`;

const heroAfter = `import { useReveal } from "../motion/useReveal";

export function Hero() {
  const ref = useReveal(80);

  return (
    <section ref={ref} className="hero">
      <h1>Aurora</h1>
      <p>Design systems that move.</p>
    </section>
  );
}
`;

const tree: FileNode[] = [
  {
    name: "src",
    path: "src",
    kind: "dir",
    children: [
      {
        name: "components",
        path: "src/components",
        kind: "dir",
        children: [
          {
            name: "Hero.tsx",
            path: "src/components/Hero.tsx",
            kind: "file",
            content: heroBefore,
            gitStatus: "modified",
          },
          {
            name: "Nav.tsx",
            path: "src/components/Nav.tsx",
            kind: "file",
            content: `export function Nav() {\n  return <nav className="nav">Aurora</nav>;\n}\n`,
          },
          {
            name: "Card.tsx",
            path: "src/components/Card.tsx",
            kind: "file",
            content: `export function Card({ title }: { title: string }) {\n  return <article className="card">{title}</article>;\n}\n`,
          },
        ],
      },
      {
        name: "motion",
        path: "src/motion",
        kind: "dir",
        children: [
          {
            name: "useReveal.ts",
            path: "src/motion/useReveal.ts",
            kind: "file",
            content: motionBefore,
            gitStatus: "modified",
          },
          {
            name: "timings.ts",
            path: "src/motion/timings.ts",
            kind: "file",
            content: `export const timings = {\n  fast: 160,\n  base: 420,\n  slow: 720,\n};\n`,
          },
        ],
      },
      {
        name: "styles",
        path: "src/styles",
        kind: "dir",
        children: [
          {
            name: "tokens.css",
            path: "src/styles/tokens.css",
            kind: "file",
            content: `:root {\n  --space: 8px;\n  --radius: 12px;\n}\n`,
          },
        ],
      },
      {
        name: "main.tsx",
        path: "src/main.tsx",
        kind: "file",
        content: `import { createRoot } from "react-dom/client";\nimport { Hero } from "./components/Hero";\n\ncreateRoot(document.getElementById("root")!).render(<Hero />);\n`,
      },
    ],
  },
  {
    name: "tests",
    path: "tests",
    kind: "dir",
    children: [
      {
        name: "reveal.test.ts",
        path: "tests/reveal.test.ts",
        kind: "file",
        content: `import { describe, it, expect } from "vitest";\nimport { timings } from "../src/motion/timings";\n\ndescribe("reveal", () => {\n  it("uses the base timing", () => {\n    expect(timings.base).toBe(420);\n  });\n});\n`,
      },
      {
        name: "hero.test.tsx",
        path: "tests/hero.test.tsx",
        kind: "file",
        content: `import { describe, it } from "vitest";\n\ndescribe("Hero", () => {\n  it("renders the headline", () => {});\n});\n`,
      },
    ],
  },
  { name: "package.json", path: "package.json", kind: "file", content: `{\n  "name": "aurora-ui"\n}\n` },
  {
    name: "README.md",
    path: "README.md",
    kind: "file",
    content: `# Aurora UI\n\nA small motion-first component library used as the MarginAgent demo workspace.\n`,
  },
];

export const demoProject: Project = {
  id: "demo-aurora",
  name: "aurora-ui",
  workspacePath: "~/code/aurora-ui",
  branch: "feat/reveal-animation",
  repository: "margin/aurora-ui",
  dirtyFiles: 2,
  ahead: 1,
  instructions:
    "Prefer small, reviewable diffs. Motion durations live in src/motion/timings.ts. Never change public component APIs without a note.",
  demo: true,
  tree,
};

export const demoDiffs = {
  reveal: { path: "src/motion/useReveal.ts", before: motionBefore, after: motionAfter },
  hero: { path: "src/components/Hero.tsx", before: heroBefore, after: heroAfter },
};

export const exampleTasks = [
  "Find and fix the slowest part of this application.",
  "Explain how authentication works in this project.",
  "Add dark mode and run the tests.",
  "Find why this animation is broken and fix it.",
];

export function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) =>
    node.kind === "dir" ? flattenFiles(node.children ?? []) : [node],
  );
}

export function findFile(nodes: FileNode[], path: string): FileNode | undefined {
  return flattenFiles(nodes).find((file) => file.path === path);
}
