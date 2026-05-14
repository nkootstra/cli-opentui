import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
  test("keeps no-argument execution in TUI mode", () => {
    expect(parseArgs([])).toEqual({ command: "tui" });
  });

  test("parses skills source, skill, and flags", () => {
    expect(
      parseArgs(["skills", "owner/repo@develop", "pdf", "--yes", "--force", "--dry-run"]),
    ).toEqual({
      command: "skills",
      source: "owner/repo@develop",
      skills: ["pdf"],
      yes: true,
      force: true,
      dryRun: true,
      list: false,
      all: false,
      json: false,
      scope: null,
    });
  });

  test("parses repeatable --skill as named installs", () => {
    expect(
      parseArgs(["skills", "owner/repo", "--skill", "pdf", "--skill", "frontend"]),
    ).toMatchObject({
      command: "skills",
      skills: ["pdf", "frontend"],
    });
  });

  test("parses short skill alias as repeatable named installs", () => {
    expect(parseArgs(["skills", "owner/repo", "-s", "pdf", "-s", "frontend"])).toMatchObject({
      command: "skills",
      skills: ["pdf", "frontend"],
    });
  });

  test("parses list and all skills flags", () => {
    expect(parseArgs(["skills", "owner/repo", "--list"])).toMatchObject({
      command: "skills",
      list: true,
    });
    expect(parseArgs(["skills", "owner/repo", "-l"])).toMatchObject({
      command: "skills",
      list: true,
    });
    expect(parseArgs(["skills", "owner/repo", "--all"])).toMatchObject({
      command: "skills",
      all: true,
    });
  });

  test("parses json output flag and nested skills update", () => {
    expect(parseArgs(["skills", "owner/repo", "--list", "--json"])).toMatchObject({
      command: "skills",
      json: true,
    });
    expect(parseArgs(["skills", "update", "--dry-run", "--json"])).toEqual({
      command: "update",
      yes: false,
      dryRun: true,
      json: true,
    });
  });

  test("parses local and global install scope flags", () => {
    expect(parseArgs(["skills", "owner/repo", "--local"])).toMatchObject({
      command: "skills",
      scope: "local",
    });
    expect(parseArgs(["skills", "owner/repo", "--global"])).toMatchObject({
      command: "skills",
      scope: "global",
    });
    expect(parseArgs(["skills", "owner/repo", "-g"])).toMatchObject({
      command: "skills",
      scope: "global",
    });
    expect(() => parseArgs(["skills", "owner/repo", "--local", "--global"])).toThrow(
      "Choose either --local or --global",
    );
  });

  test("parses update flags", () => {
    expect(parseArgs(["update", "--yes", "--dry-run"])).toEqual({
      command: "update",
      yes: true,
      dryRun: true,
      json: false,
    });
  });

  test("parses top-level list command", () => {
    expect(parseArgs(["list"])).toEqual({ command: "list", json: false, scope: null });
    expect(parseArgs(["ls"])).toEqual({ command: "list", json: false, scope: null });
    expect(parseArgs(["list", "--global"])).toEqual({ command: "list", json: false, scope: "global" });
    expect(parseArgs(["list", "--local"])).toEqual({ command: "list", json: false, scope: "local" });
    expect(parseArgs(["list", "--json"])).toEqual({ command: "list", json: true, scope: null });
  });

  test("parses nested skills list command", () => {
    expect(parseArgs(["skills", "list"])).toEqual({ command: "list", json: false, scope: null });
    expect(parseArgs(["skills", "ls"])).toEqual({ command: "list", json: false, scope: null });
    expect(parseArgs(["skills", "list", "--global"])).toEqual({ command: "list", json: false, scope: "global" });
  });

  test("parses top-level remove command", () => {
    expect(parseArgs(["remove", "foo"])).toEqual({
      command: "remove",
      skill: "foo",
      yes: false,
      json: false,
      scope: null,
    });
    expect(parseArgs(["rm", "foo", "--yes", "--global"])).toEqual({
      command: "remove",
      skill: "foo",
      yes: true,
      json: false,
      scope: "global",
    });
    expect(parseArgs(["remove", "foo", "--local", "--json"])).toEqual({
      command: "remove",
      skill: "foo",
      yes: false,
      json: true,
      scope: "local",
    });
  });

  test("parses nested skills remove command", () => {
    expect(parseArgs(["skills", "remove", "foo"])).toEqual({
      command: "remove",
      skill: "foo",
      yes: false,
      json: false,
      scope: null,
    });
    expect(parseArgs(["skills", "rm", "foo", "--yes"])).toEqual({
      command: "remove",
      skill: "foo",
      yes: true,
      json: false,
      scope: null,
    });
  });

  test("rejects remove without a skill name", () => {
    expect(() => parseArgs(["remove"])).toThrow("Usage");
    expect(() => parseArgs(["remove", "--yes"])).toThrow("Usage");
  });

  test("rejects list with conflicting scope flags", () => {
    expect(() => parseArgs(["list", "--local", "--global"])).toThrow("Choose either");
  });

  test("rejects invalid commands and missing values", () => {
    expect(() => parseArgs(["skills"])).toThrow("Usage");
    expect(() => parseArgs(["skills", "owner/repo", "--skill"])).toThrow("Expected value");
    expect(() => parseArgs(["install", "owner/repo"])).toThrow("Unknown command");
    expect(() => parseArgs(["wat"])).toThrow("Unknown command");
  });
});
