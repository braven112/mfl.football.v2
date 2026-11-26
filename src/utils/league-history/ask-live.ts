/**
 * Ask the History — the live chat, client-side (Brandon, 2026-11-26: "it
 * doesn't feel like someone is really answering me right where I was").
 *
 * `askLive` posts a question with `stream: true` and reads the API's
 * newline-delimited events (src/pages/api/league-history/ask.ts): each lookup
 * as Buck runs it, then his answer as he writes it, then the finished answer.
 * A refusal before the work starts (sign-in, rate limit, a bad question) is
 * still a plain JSON error, so it is read the same way it always was.
 *
 * `liveAnswer` is the card Buck "types" into while he works. It is replaced
 * by the finished answer (ask-render.ts renderAnswer), which carries the big
 * stat, the chart and the rows: those are only known once he is done,
 * because picking the chart is the last thing he decides.
 */
import { historianByline, type ClientAnswer } from './ask-render';

export interface AskLiveBody {
  league: string;
  question: string;
  after?: string;
}

export interface AskLiveResult<T = ClientAnswer> {
  ok: boolean;
  /** The HTTP status of a refusal (429 = out of questions); 200 for a streamed answer. */
  status: number;
  data: T & { error?: string };
}

type LiveEvent = { type: 'step'; text: string } | { type: 'answer'; text: string } | ({ type: 'done' | 'error' } & Record<string, unknown>);

export async function askLive<T = ClientAnswer>(
  body: AskLiveBody,
  on: { step?: (text: string) => void; answer?: (text: string) => void } = {},
): Promise<AskLiveResult<T>> {
  const res = await fetch('/api/league-history/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, after: body.after || undefined, stream: true }),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('ndjson') || !res.body) {
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok && !data.error, status: res.status, data };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: LiveEvent | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: LiveEvent;
    try {
      event = JSON.parse(line) as LiveEvent;
    } catch {
      return;
    }
    if (event.type === 'step') on.step?.(String(event.text ?? ''));
    else if (event.type === 'answer') on.answer?.(String(event.text ?? ''));
    else if (event.type === 'done' || event.type === 'error') final = event;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
    if (done) break;
  }
  handle(buffer);
  const last = final as LiveEvent | null;
  if (!last) throw new Error('The answer stream ended early');
  const { type: kind, ...data } = last as { type: string } & Record<string, unknown>;
  if (kind === 'error') return { ok: false, status: 503, data: { error: 'Something went wrong. Try again.', ...data } as T & { error?: string } };
  return { ok: true, status: res.status, data: data as T & { error?: string } };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export interface LiveAnswer {
  node: HTMLElement;
  step: (text: string) => void;
  answer: (text: string) => void;
}

/**
 * Buck's answer while he works: his byline, what he is looking up (each
 * lookup ticks in as it runs), then his words as he writes them.
 */
export function liveAnswer(): LiveAnswer {
  const article = el('article', 'ha-answer ha-live');
  article.setAttribute('aria-busy', 'true');
  const status = el('p', 'ha-live__status', 'Digging through the archives…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const steps = el('ol', 'ha-live__steps');
  steps.setAttribute('aria-label', 'What Buck looked up');
  const words = el('p', 'ha-answer__a ha-live__words');
  words.hidden = true;
  article.append(historianByline(), steps, status, words);
  const seen = new Set<string>();
  return {
    node: article,
    step(text) {
      if (!text || seen.has(text)) return;
      seen.add(text);
      steps.append(el('li', 'ha-live__step', text));
      status.textContent = 'Checking the record…';
    },
    answer(text) {
      if (!text) return;
      words.hidden = false;
      words.textContent = text;
      status.textContent = 'Writing it up…';
      article.classList.add('ha-live--writing');
    },
  };
}

/**
 * A guest's answer arrives whole (it is masked before it is sent), and so
 * does any answer when streaming is not available: type it out anyway so the
 * chat reads the same either way. Resolves once the words are all shown.
 */
export function typeOut(live: LiveAnswer, text: string, perChar = 14): Promise<void> {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !text) {
    live.answer(text);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + 3);
      live.answer(text.slice(0, i));
      if (i >= text.length) resolve();
      else setTimeout(tick, perChar * 3);
    };
    tick();
  });
}

export interface ChatTurnOptions {
  thread: HTMLElement;
  league: string;
  base: string;
  question: string;
  /** The answer this question follows up on ('' starts a new conversation). */
  after: string;
  /** How many turns the conversation already has (0 = this is the first question). */
  turns: number;
  /** The conversation's first question, which the Share text leads with. */
  firstQuestion: string;
}

export type ChatTurnOutcome<T> = { ok: true; data: T & ClientAnswer } | { ok: false; error: string; data: (T & { error?: string }) | null };

/**
 * One turn of the chat, wherever it is shown (the ask screen, the History
 * home): the asker's bubble, Buck answering live, then the finished answer
 * with its own Share button. On a refusal or a lost connection the turn is
 * taken back out, so the caller can put the question back in the box.
 */
export async function chatTurn<T = Record<string, never>>(o: ChatTurnOptions, render: (data: ClientAnswer, base: string) => HTMLElement): Promise<ChatTurnOutcome<T>> {
  const turn = el('section', 'hask-turn');
  const bubble = el('p', 'hask-asked');
  bubble.append(el('span', 'hask-asked__kicker', o.turns === 0 ? 'You asked' : 'Then you asked'), o.question);
  const live = liveAnswer();
  turn.append(bubble, live.node);
  o.thread.append(turn);
  turn.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let typed = false;
  let result: AskLiveResult<T>;
  try {
    result = await askLive<T>(
      { league: o.league, question: o.question, after: o.after },
      {
        step: live.step,
        answer: (text) => {
          typed = true;
          live.answer(text);
        },
      },
    );
  } catch {
    turn.remove();
    return { ok: false, error: 'Lost the connection. Try again.', data: null };
  }
  const data = result.data as T & ClientAnswer;
  if (!result.ok || data.error) {
    turn.remove();
    return { ok: false, error: data.error ?? 'Something went wrong. Try again.', data };
  }
  if (!typed) await typeOut(live, data.answer);
  live.node.replaceWith(render(data, o.base));
  if (data.id) {
    // One Share, under the newest answer: its link carries the whole conversation.
    o.thread.querySelectorAll('.hask-turn > [data-hask-share]').forEach((b) => b.remove());
    const share = el('button', 'cta cta--primary hask-share', 'Share to the group chat') as HTMLButtonElement;
    share.type = 'button';
    share.dataset.haskShare = '';
    share.dataset.id = data.id;
    share.dataset.question = o.firstQuestion || o.question;
    turn.append(share);
  }
  return { ok: true, data };
}
