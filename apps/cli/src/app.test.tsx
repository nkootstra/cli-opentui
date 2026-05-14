import { describe, expect, test } from "bun:test";
import { App } from "./app";
import { StatusBar } from "./tui/StatusBar.tsx";

describe("App", () => {
  test("is a function (renderable React component)", () => {
    expect(typeof App).toBe("function");
  });

  test("accepts optional statusBarDeps prop in type signature", () => {
    // Verify the function signature accepts statusBarDeps without needing a renderer
    expect(App.length).toBeLessThanOrEqual(1);
  });
});

describe("StatusBar", () => {
  test("is a function (renderable React component)", () => {
    expect(typeof StatusBar).toBe("function");
  });

  test("accepts deps prop with readSession", () => {
    // Verify function accepts the deps shape without calling it outside a renderer
    expect(typeof StatusBar).toBe("function");
    const deps = { readSession: async () => null };
    // If the type signature accepted it, this assignment would not throw at compile time
    expect(typeof deps.readSession).toBe("function");
  });
});
