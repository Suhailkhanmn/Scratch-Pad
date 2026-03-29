import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CreateProjectInput,
  OpenProjectRepoInput,
  PreferredAdapter,
  Project,
} from "@scratch-pad/shared";

type ProjectRow = {
  id: string;
  name: string;
  repo_path: string | null;
  preferred_adapter: PreferredAdapter;
  status: "idle";
  created_at: string;
  updated_at: string;
};

export function createProject(
  database: DatabaseSync,
  input: CreateProjectInput,
): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    repoPath: null,
    preferredAdapter: input.preferredAdapter ?? null,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };

  database
    .prepare(
      `
        INSERT INTO projects (
          id,
          name,
          repo_path,
          preferred_adapter,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      project.id,
      project.name,
      project.repoPath,
      project.preferredAdapter,
      project.status,
      project.createdAt,
      project.updatedAt,
    );

  return project;
}

export function getProjectById(
  database: DatabaseSync,
  id: string,
): Project | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          name,
          repo_path,
          preferred_adapter,
          status,
          created_at,
          updated_at
        FROM projects
        WHERE id = ?
      `,
    )
    .get(id) as ProjectRow | undefined;

  return row ? mapProjectRow(row) : null;
}

export function updateProjectSetup(
  database: DatabaseSync,
  id: string,
  input: OpenProjectRepoInput,
): Project | null {
  const existingProject = getProjectById(database, id);

  if (!existingProject) {
    return null;
  }

  const normalizedRepoPath = normalizeRepoPath(input.repoPath);
  const updatedAt = new Date().toISOString();
  const preferredAdapter =
    input.preferredAdapter === undefined
      ? existingProject.preferredAdapter
      : input.preferredAdapter;

  database
    .prepare(
      `
        UPDATE projects
        SET
          repo_path = ?,
          preferred_adapter = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .run(normalizedRepoPath, preferredAdapter, updatedAt, id);

  return getProjectById(database, id);
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    preferredAdapter: row.preferred_adapter,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRepoPath(repoPath: string) {
  const normalizedPath = resolve(repoPath.trim());
  const pathStats = statSync(normalizedPath, { throwIfNoEntry: false });

  if (!pathStats) {
    throw new Error(
      "Repo path does not exist on disk. Save an existing local directory.",
    );
  }

  if (!pathStats.isDirectory()) {
    throw new Error("Repo path must point to a local directory, not a file.");
  }

  return normalizedPath;
}
