import { mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type {
  CreateDirectoryInput,
  DirectoryBrowserResult,
} from "@scratch-pad/shared";

export function browseDirectories(inputPath?: string): DirectoryBrowserResult {
  const currentPath = normalizeDirectoryPath(inputPath);
  const pathStats = statSync(currentPath, { throwIfNoEntry: false });

  if (!pathStats) {
    throw new Error("Directory does not exist.");
  }

  if (!pathStats.isDirectory()) {
    throw new Error("Path must point to a directory.");
  }

  const directories = readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: resolve(currentPath, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const parentPath = dirname(currentPath);

  return {
    currentPath,
    parentPath: parentPath === currentPath ? null : parentPath,
    directories,
  };
}

export function createDirectory(input: CreateDirectoryInput) {
  const parentPath = normalizeDirectoryPath(input.parentPath);
  const parentStats = statSync(parentPath, { throwIfNoEntry: false });

  if (!parentStats || !parentStats.isDirectory()) {
    throw new Error("Choose an existing parent directory first.");
  }

  const nextPath = resolve(parentPath, input.name.trim());
  const existingStats = statSync(nextPath, { throwIfNoEntry: false });

  if (existingStats) {
    if (!existingStats.isDirectory()) {
      throw new Error("A file already exists at that folder path.");
    }

    return {
      path: nextPath,
      message: "Folder already exists.",
    };
  }

  mkdirSync(nextPath, { recursive: false });

  return {
    path: nextPath,
    message: "Folder created.",
  };
}

function normalizeDirectoryPath(inputPath?: string) {
  const trimmedPath = inputPath?.trim();

  if (!trimmedPath) {
    return homedir();
  }

  if (trimmedPath === "~") {
    return homedir();
  }

  if (trimmedPath.startsWith("~/")) {
    return resolve(homedir(), trimmedPath.slice(2));
  }

  return resolve(trimmedPath);
}
