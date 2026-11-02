import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { visibleMarkers } from '@/lib/suggest';
import { getMeeting, listMarkers, listNotes, listSegments } from '@/lib/db';
import { buildTimeline, type TimelineItem } from '@/lib/live';
import { itemText, matchIds, splitMatches, transcriptToText } from '@/lib/library';
import { displayName } from '@/lib/speakers';
import { formatClock, formatDuration } from '@/lib/time';
import type { Meeting } from '@/lib/types';
import { redactionsOf, type Span } from '@/lib/redact';
import { Button, EmptyState, Spinner, Tag } from '../components';
import { useRouter } from '../router';
import './v4/v4.css';

type Data = { meeting?: Meeting; items: TimelineItem[] };

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

/** Plain text for copying: "[12:04] Name: text", notes as "Your note". */
function copyText(items: TimelineItem[], speakers: Meeting['speakers']): string {
  return items
    .map((it) => {
      const at = `[${formatClock(it.atMs)}]`;
      if (it.kind === 'segment') return `${at} ${displayName(it.segment, speakers)}: ${it.segment.text}`;
      return transcriptToText([it]);
    })
    .join('\n');
}

/** Timeline items with each redaction placed at its time. */
function withRedactions(items: TimelineItem[], marks: { startMs: number; endMs: number }[]) {
  const out: (TimelineItem | { mark: { startMs: number; endMs: number } })[] = [];
  const left = [...marks].sort((a, b) => a.startMs - b.startMs);
  for (const it of items) {
    while (left.length && left[0]!.startMs <= it.atMs) out.push({ mark: left.shift()! });
    out.push(it);
  }
  return [...out, ...left.map((mark) => ({ mark }))];
}

export default function Transcript() {
  const { route, navigate, back } = useRouter();
  const meetingId = route.params.meetingId;
  const [data, setData] = useState<Data | undefined>();
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const atMsParam = Number(route.params.atMs);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const scrolledFor = useRef<string | undefined>(undefined);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [picked, setPicked] = useState<Span | null>(null);

  const load = async () => {
    if (!meetingId) { setError(true); return; }
    setError(false);
    setData(undefined);
    try {
      const [meeting, segments, notes, markers] = await Promise.all([
        getMeeting(meetingId), listSegments(meetingId), listNotes(meetingId), listMarkers(meetingId),
      ]);
      setData({ meeting, items: buildTimeline(segments, notes, visibleMarkers(markers)) });
    } catch {
      setError(true);
    }
  };
  useEffect(() => { void load(); }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = useMemo(() => matchIds(data?.items ?? [], query), [data, query]);
  useEffect(() => setCurrent(0), [query]);
  const currentId = ids.length ? ids[Math.min(current, ids.length - 1)] : undefined;
  useEffect(() => {
    if (currentId) rowRefs.current[currentId]?.scrollIntoView?.({ block: 'center' });
  }, [currentId]);

  const targetId = useMemo(() => {
    if (!data?.items.length || route.params.atMs === undefined || !Number.isFinite(atMsParam)) return undefined;
    return data.items.reduce((best, it) => (Math.abs(it.atMs - atMsParam) < Math.abs(best.atMs - atMsParam) ? it : best)).id;
  }, [data, atMsParam, route.params.atMs]);
  useEffect(() => {
    if (!targetId || scrolledFor.current === `${meetingId}:${atMsParam}`) return;
    scrolledFor.current = `${meetingId}:${atMsParam}`;
    targetRef.current?.scrollIntoView?.({ block: 'center' });
  }, [targetId, meetingId, atMsParam]);

  // Selecting lines offers "Redact": the span runs from the first selected line's start to the last one's end.
  useEffect(() => {
    const onSelect = () => {
      const sel = document.getSelection();
      const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : undefined;
      const lines = range ? (data?.items ?? []).filter((it) => it.kind === 'segment' && rowRefs.current[it.id] && range.intersectsNode(rowRefs.current[it.id]!)) : [];
      const segs = lines.flatMap((it) => (it.kind === 'segment' ? [it.segment] : []));
      setPicked(segs.length ? { startMs: Math.min(...segs.map((x) => x.startMs)), endMs: Math.max(...segs.map((x) => x.endMs)) } : null);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [data]);

  const step = (d: number) => ids.length && setCurrent((c) => (c + d + ids.length) % ids.length);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(copyText(data?.items ?? [], data?.meeting?.speakers));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const meeting = data?.meeting;
  const sub = meeting
    ? `${meeting.title || 'Untitled meeting'}${meeting.endedAt !== undefined ? ` · ${formatDuration(meeting.endedAt - meeting.startedAt)}` : ''}`
    : '';

  return (
    <main className="screen tr">
      <header className="lib-head">
        <button type="button" className="icon-btn" aria-label="Back to summary" onClick={back}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div className="tr-title"><span>Transcript</span><small>{sub}</small></div>
        {meeting?.speakers && Object.keys(meeting.speakers).length > 0 && (
          <Button variant="secondary" onClick={() => navigate('speakers', { meetingId })}>Rename speakers</Button>
        )}
      </header>

      <div className="tr-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E7079" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <label htmlFor="find" className="sr-only">Find in transcript</label>
        <input
          id="find" type="search" placeholder="Find in transcript" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }}
        />
        {query.trim() && <span className="tr-count" aria-live="polite">{ids.length ? `${Math.min(current, ids.length - 1) + 1} of ${ids.length}` : 'No matches'}</span>}
      </div>

      {error ? (
        <EmptyState title="Couldn’t load the transcript" action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      ) : data === undefined ? (
        <div className="lib-wait"><Spinner label="Loading transcript" /></div>
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing was transcribed" body="This meeting has no transcript yet." />
      ) : (
        <section className="tr-list" aria-label="Transcript">
          {withRedactions(data.items, redactionsOf(data.meeting)).map((entry) => {
            if ('mark' in entry) {
              const { mark } = entry;
              return (
                <div className="rd-gone" key={`redacted-${mark.startMs}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
                  <span className="rd-gone-at">{formatClock(mark.startMs)}</span>Redacted · {formatClock(mark.endMs - mark.startMs)}
                </div>
              );
            }
            const it = entry;
            const on = it.id === currentId;
            const hit = ids.includes(it.id);
            const isTarget = it.id === targetId;
            const cls = `tr-row${isTarget ? ' tr-target' : ''}${it.kind === 'note' ? ' tr-note' : ''}${hit ? ' tr-hit' : ''}${on ? ' tr-on' : ''}`;
            const clock = <span className="tr-clock">{formatClock(it.atMs)}</span>;
            if (it.kind === 'marker') {
              return (
                <div className={cls} key={it.id} ref={isTarget ? targetRef : undefined} aria-current={isTarget ? 'true' : undefined}>
                  {clock}
                  <div className="tr-body"><Tag kind={it.marker.kind} />{it.marker.label && <span className="tr-text">{it.marker.label}</span>}</div>
                </div>
              );
            }
            const who = it.kind === 'note' ? 'Your note' : displayName(it.segment, meeting?.speakers);
            return (
              <div className={cls} key={it.id} ref={(el) => { rowRefs.current[it.id] = el; if (isTarget) targetRef.current = el; }} aria-current={isTarget ? 'true' : undefined}>
                {clock}
                <div className="tr-body">
                  <span className={`tr-who${who === 'You' ? '' : ' alt'}`}>{who}</span>
                  <span className="tr-text"><Marked text={itemText(it)} query={query} /></span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {picked && meetingId && (
        <div className="rd-bar tr-redact">
          <span className="rd-range">{formatClock(picked.startMs)} to {formatClock(picked.endMs)}</span>
          <button type="button" className="rd-bar-btn" onClick={() => navigate('redact', { meetingId, atMs: picked.startMs, endMs: picked.endMs })}>
            Redact {formatClock(picked.endMs - picked.startMs)}
          </button>
        </div>
      )}

      <footer className="tr-foot">
        <Button variant="secondary" className="tr-btn" onClick={() => void copyAll()} disabled={!data?.items.length}>
          {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Couldn’t copy' : 'Copy all'}
        </Button>
        <Button className="tr-btn" onClick={() => navigate('export', { meetingId })} disabled={!meetingId}>Export</Button>
      </footer>
    </main>
  );
}
