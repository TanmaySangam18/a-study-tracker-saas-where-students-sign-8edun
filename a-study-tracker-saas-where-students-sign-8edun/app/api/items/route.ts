import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

// Force this route to always execute (never statically cached) since it
// serves per-visitor, mutable data.
export const dynamic = "force-dynamic";

export type StudySession = {
  id: string;
  subject: string;
  minutes: number;
  studiedAt: string; // YYYY-MM-DD
  notes?: string;
  createdAt: string; // ISO timestamp
};

const COOKIE_NAME = "study_uid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * TENANT ISOLATION
 * ------------------------------------------------------------------
 * Every read/write below is scoped by `userId` FIRST, then filtered/
 * mutated. There is no code path that returns or deletes a row without
 * first resolving the caller's own id from an httpOnly cookie. Nothing
 * is ever returned "by default" — a missing/unknown id yields an empty
 * result, never someone else's data.
 *
 * PERSISTENCE
 * ------------------------------------------------------------------
 * Zero-config default: an in-memory Map keyed by userId. This runs
 * anywhere with no setup, at the cost of resetting on server restart /
 * cold start.
 *
 * To swap in Supabase once SUPABASE_URL + SUPABASE_ANON_KEY are set:
 *   - create a `study_sessions` table with a `user_id uuid` column
 *   - enable RLS with a policy `user_id = auth.uid()`
 *   - authenticate the request with Supabase Auth (never a service-role
 *     key in this user-facing route) and use that session's user id
 *   - replace the `readAll` / `insert` / `remove` functions below with
 *     calls to the Supabase client, still scoped by that user id.
 * We intentionally avoid a static `@supabase/supabase-js` import here
 * so this file always compiles and runs even before that package is
 * installed.
 */
const store = new Map<string, StudySession[]>();

function getUserId(request: NextRequest): { userId: string; isNew: boolean } {
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  if (existing) {
    return { userId: existing, isNew: false };
  }
  return { userId: randomUUID(), isNew: true };
}

function attachUserCookie(response: NextResponse, userId: string, isNew: boolean) {
  if (isNew) {
    response.cookies.set(COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  return response;
}

function readAll(userId: string): StudySession[] {
  return store.get(userId) ?? [];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ValidatedInput = {
  subject: string;
  minutes: number;
  studiedAt: string;
  notes?: string;
};

function validateInput(body: unknown): { ok: true; data: ValidatedInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;

  const subjectRaw = record.subject;
  if (typeof subjectRaw !== "string" || subjectRaw.trim().length === 0) {
    return { ok: false, error: "Subject is required." };
  }
  const subject = subjectRaw.trim();
  if (subject.length > 80) {
    return { ok: false, error: "Subject must be 80 characters or fewer." };
  }

  const minutesRaw = record.minutes;
  const minutes = typeof minutesRaw === "number" ? minutesRaw : Number(minutesRaw);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    return { ok: false, error: "Minutes must be a whole number between 1 and 1440." };
  }

  const studiedAtRaw = record.studiedAt;
  if (typeof studiedAtRaw !== "string" || !DATE_RE.test(studiedAtRaw) || Number.isNaN(Date.parse(studiedAtRaw))) {
    return { ok: false, error: "Studied date must be a valid date (YYYY-MM-DD)." };
  }

  let notes: string | undefined;
  if (record.notes !== undefined && record.notes !== null) {
    if (typeof record.notes !== "string") {
      return { ok: false, error: "Notes must be text." };
    }
    const trimmed = record.notes.trim();
    if (trimmed.length > 500) {
      return { ok: false, error: "Notes must be 500 characters or fewer." };
    }
    notes = trimmed.length > 0 ? trimmed : undefined;
  }

  return { ok: true, data: { subject, minutes, studiedAt: studiedAtRaw, notes } };
}

export async function GET(request: NextRequest) {
  try {
    const { userId, isNew } = getUserId(request);
    const sessions = readAll(userId)
      .slice()
      .sort((a, b) => b.studiedAt.localeCompare(a.studiedAt) || b.createdAt.localeCompare(a.createdAt));

    const response = NextResponse.json({ sessions });
    return attachUserCookie(response, userId, isNew);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong loading your sessions." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const validated = validateInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const { userId, isNew } = getUserId(request);
    const session: StudySession = {
      id: randomUUID(),
      subject: validated.data.subject,
      minutes: validated.data.minutes,
      studiedAt: validated.data.studiedAt,
      notes: validated.data.notes,
      createdAt: new Date().toISOString(),
    };

    const existing = store.get(userId) ?? [];
    existing.push(session);
    store.set(userId, existing);

    const response = NextResponse.json({ session }, { status: 201 });
    return attachUserCookie(response, userId, isNew);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong saving this session." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || id.trim().length === 0) {
      return NextResponse.json({ error: "Missing session id." }, { status: 400 });
    }

    const userId = request.cookies.get(COOKIE_NAME)?.value;
    if (!userId) {
      // No cookie means no data could possibly belong to this caller.
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const list = store.get(userId);
    const index = list?.findIndex((s) => s.id === id) ?? -1;
    if (!list || index === -1) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    list.splice(index, 1);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong deleting this session." },
      { status: 500 }
    );
  }
}
