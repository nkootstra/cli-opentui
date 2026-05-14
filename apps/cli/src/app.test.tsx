import { describe, expect, test } from "bun:test";
import { App } from "./app";

describe("App", () => {
  test("is a function (renderable React component)", () => {
    expect(typeof App).toBe("function");
  });
});
