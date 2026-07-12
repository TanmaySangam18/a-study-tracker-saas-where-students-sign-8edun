"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { StudySession } from "./api/items/route";

const SUBJECT_SUGGESTIONS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "History",
  "English",
  "Computer Science",
];

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start of week
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDisplayDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type SubjectTotal = { subject: string; minutes: number };

export default function Home() {
  const [sessions, setSessions] = useState<StudySession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [minutes, setMinutes] = useState("");
  const [studiedAt, setStudiedAt] = useState(() => toDateKey(new Date()));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/items");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load sessions.");
      }
      setSessions(data.sessions as StudySession[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load sessions.");
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedSubject = subject.trim();
    const minutesNum = Number(minutes);

    if (!trimmedSubject) {
      setFormError("Add a subject to log this session.");
      return;
    }
    if (!Number.isFinite(minutesNum) || minutesNum <= 0) {
      setFormError("Enter how many minutes you studied.");
      return;
    }
    if (!studiedAt) {
      setFormError("Pick the date you studied.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: trimmedSubject,
          minutes: Math.round(minutesNum),
          studiedAt,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Could not save this session.");
        return;
      }
      setSessions((prev) => (prev ? [data.session as StudySession, ...prev] : [data.session]));
      setSubject("");
      setMinutes("");
      setNotes("");
    } catch {
      setFormError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/items?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Could not delete this session.");
        return;
      }
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch {
      setActionError("Network error — check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const now = new Date();
  const weekStartKey = toDateKey(startOfWeek(now));
  const weekEndKey = toDateKey(endOfWeek(now));
  const weekSessions = (sessions ?? []).filter(
    (s) => s.studiedAt >= weekStartKey && s.studiedAt <= weekEndKey
  );
  const weekTotalMinutes = weekSessions.reduce((sum, s) => sum + s.minutes, 0);

  const subjectTotals: SubjectTotal[] = Object.values(
    weekSessions.reduce<Record<string, SubjectTotal>>((acc, s) => {
      const key = s.subject;
      if (!acc[key]) acc[key] = { subject: key, minutes: 0 };
      acc[key].minutes += s.minutes;
      return acc;
    }, {})
  )
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const maxSubjectMinutes = subjectTotals[0]?.minutes ?? 1;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
        <header className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
            Study Tracker
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl">
            Your week at a glance
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-zinc-500">
            Log every session the moment you finish it. Your weekly totals and
            subject breakdown below update instantly — no guesswork, just
            what you actually studied.
          </p>
        </header>

        <section
          aria-label="Weekly summary"
          className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              This week
            </h2>
            <p className="text-sm text-zinc-500">
              {formatDisplayDate(weekStartKey)} – {formatDisplayDate(weekEndKey)}
            </p>
          </div>

          {sessions === null ? (
            <div className="mt-6 space-y-3" aria-hidden="true">
              <div className="h-8 w-40 animate-pulse rounded-md bg-zinc-100" />
              <div className="h-3 w-full animate-pulse rounded-full bg-zinc-100" />
              <div className="h-3 w-5/6 animate-pulse rounded-full bg-zinc-100" />
            </div>
          ) : weekSessions.length === 0 ? (
            <p className="mt-6 text-sm leading-6 text-zinc-500">
              No sessions logged this week yet. Add one below to see your
              totals here.
            </p>
          ) : (
            <div className="mt-6 space-y-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight text-zinc-900">
                  {formatDuration(weekTotalMinutes)}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  across {weekSessions.length}{" "}
                  {weekSessions.length === 1 ? "session" : "sessions"}
                </p>
              </div>

              <div className="space-y-3">
                {subjectTotals.map((item) => (
                  <div key={item.subject}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-zinc-700">
                        {item.subject}
                      </span>
                      <span className="text-zinc-500">
                        {formatDuration(item.minutes)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all duration-150"
                        style={{
                          width: `${Math.max(
                            6,
                            (item.minutes / maxSubjectMinutes) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
          <section
            aria-label="Log a study session"
            className="h-fit rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Log a session
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Takes ten seconds. Do it right after you finish studying.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label
                  htmlFor="subject"
                  className="mb-1.5 block text-sm font-medium text-zinc-700"
                >
                  Subject
                </label>
                <input
                  id="subject"
                  name="subject"
                  type="text"
                  list="subject-suggestions"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Organic Chemistry"
                  maxLength={80}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                />
                <datalist id="subject-suggestions">
                  {SUBJECT_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="minutes"
                    className="mb-1.5 block text-sm font-medium text-zinc-700"
                  >
                    Minutes
                  </label>
                  <input
                    id="minutes"
                    name="minutes"
                    type="number"
                    min={1}
                    max={1440}
                    step={5}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    placeholder="45"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                  />
                </div>
                <div>
                  <label
                    htmlFor="studiedAt"
                    className="mb-1.5 block text-sm font-medium text-zinc-700"
                  >
                    Date
                  </label>
                  <input
                    id="studiedAt"
                    name="studiedAt"
                    type="date"
                    value={studiedAt}
                    max={toDateKey(new Date())}
                    onChange={(e) => setStudiedAt(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="notes"
                  className="mb-1.5 block text-sm font-medium text-zinc-700"
                >
                  Notes <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  placeholder="What did you cover?"
                  className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                />
              </div>

              {formError ? (
                <p role="alert" className="text-sm leading-6 text-red-600">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-150 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Log session"}
              </button>
            </form>
          </section>

          <section aria-label="Recent sessions" className="min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                Recent sessions
              </h2>
              {sessions && sessions.length > 0 ? (
                <span className="text-sm text-zinc-500">
                  {sessions.length} total
                </span>
              ) : null}
            </div>

            {actionError ? (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
              >
                {actionError}
              </p>
            ) : null}

            {sessions === null && !loadError ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-xl border border-zinc-200 bg-white"
                  />
                ))}
              </div>
            ) : loadError ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
                <p className="text-sm leading-6 text-red-600">{loadError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setSessions(null);
                    loadSessions();
                  }}
                  className="mt-4 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition duration-150 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  Try again
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
                <p className="text-base font-semibold text-zinc-900">
                  No sessions yet
                </p>
                <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-zinc-500">
                  Log your first study session on the left — it'll show up
                  here and count toward this week's total.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="rounded-xl border border-zinc-200 bg-white p-4 transition duration-150 hover:border-zinc-300 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-zinc-900">
                          {session.subject}
                        </p>
                        <p className="mt-0.5 text-sm text-zinc-500">
                          {formatDisplayDate(session.studiedAt)} ·{" "}
                          {formatDuration(session.minutes)}
                        </p>
                        {session.notes ? (
                          <p className="mt-2 text-sm leading-6 text-zinc-600">
                            {session.notes}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(session.id)}
                        disabled={deletingId === session.id}
                        aria-label={`Delete ${session.subject} session`}
                        className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-400 transition duration-150 hover:bg-zinc-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === session.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
