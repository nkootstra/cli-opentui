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

  test("rejects invalid commands and missing values", () => {
    expect(() => parseArgs(["skills"])).toThrow("Usage");
    expect(() => parseArgs(["skills", "owner/repo", "--skill"])).toThrow("Expected value");
    expect(() => parseArgs(["install", "owner/repo"])).toThrow("Unknown command");
    expect(() => parseArgs(["wat"])).toThrow("Unknown command");
  });
});
