import { describe, expect, test } from "bun:test";
import { App } from "./app";

describe("App", () => {
  test("renders the CLI title", () => {
    const tree = App();
    const title = tree.props.children.props.children[0];

    expect(title.type).toBe("ascii-font");
    expect(title.props.text).toBe("CLI");
  });

  test("renders the starter prompt", () => {
    const tree = App();
    const prompt = tree.props.children.props.children[1];

    expect(prompt.type).toBe("text");
    expect(prompt.props.children).toBe("What will you build?");
  });
});
