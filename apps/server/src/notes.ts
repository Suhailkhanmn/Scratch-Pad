import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CreateScratchNoteInput,
  ScratchNote,
  UpdateScratchNoteInput,
} from "@scratch-pad/shared";

type ScratchNoteRow = {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export function createScratchNote(
  database: DatabaseSync,
  projectId: string,
  input: CreateScratchNoteInput,
): ScratchNote {
  const now = new Date().toISOString();
  const note: ScratchNote = {
    id: randomUUID(),
    projectId,
    content: input.content.trim(),
    createdAt: now,
    updatedAt: now,
  };

  database
    .prepare(
      `
        INSERT INTO scratch_notes (
          id,
          project_id,
          content,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(
      note.id,
      note.projectId,
      note.content,
      note.createdAt,
      note.updatedAt,
    );

  return note;
}

export function listScratchNotesByProjectId(
  database: DatabaseSync,
  projectId: string,
): ScratchNote[] {
  const rows = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          content,
          created_at,
          updated_at
        FROM scratch_notes
        WHERE project_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `,
    )
    .all(projectId) as ScratchNoteRow[];

  return rows.map(mapScratchNoteRow);
}

export function updateScratchNote(
  database: DatabaseSync,
  id: string,
  input: UpdateScratchNoteInput,
): ScratchNote | null {
  const updatedAt = new Date().toISOString();

  const result = database
    .prepare(
      `
        UPDATE scratch_notes
        SET
          content = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .run(input.content.trim(), updatedAt, id);

  if (result.changes === 0) {
    return null;
  }

  return getScratchNoteById(database, id);
}

export function deleteScratchNote(
  database: DatabaseSync,
  id: string,
): boolean {
  const result = database
    .prepare("DELETE FROM scratch_notes WHERE id = ?")
    .run(id);

  return result.changes > 0;
}

function getScratchNoteById(
  database: DatabaseSync,
  id: string,
): ScratchNote | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          content,
          created_at,
          updated_at
        FROM scratch_notes
        WHERE id = ?
      `,
    )
    .get(id) as ScratchNoteRow | undefined;

  return row ? mapScratchNoteRow(row) : null;
}

function mapScratchNoteRow(row: ScratchNoteRow): ScratchNote {
  return {
    id: row.id,
    projectId: row.project_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
