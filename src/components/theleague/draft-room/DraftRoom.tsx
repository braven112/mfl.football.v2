import React, { useReducer, useMemo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import type {
  DraftRoomPageData,
  DraftRoomState,
  DraftRoomAction,
  DraftRoomPick,
  DraftRoomPlayer,
  DraftQueueItem,
  DraftStatusResponse,
  ChatMessage,
  DraftContext,
  DraftRoomMode,
} from '../../../types/draft-room';
import { ConfirmDialog } from './ConfirmDialog';
import { DraftTimerBanner } from './DraftTimerBanner';
import { DraftBoardPanel } from './DraftBoardPanel';
import { PlayerPoolPanel } from './PlayerPoolPanel';
import { MobileTabBar } from './MobileTabBar';
import { DraftChatPanel, broadcastPickToChat } from './DraftChatPanel';
import { getQueue, saveQueue } from '../../../utils/draft-queue-storage';
import { useMockDraftSocket } from '../../../hooks/useMockDraftSocket';
import '../../../styles/draft-room.css';

// DraftQueuePanel lazy-loaded — @dnd-kit (~40 KB gzipped) only pulled in when
// the queue tab is opened. Most users never open it.
const DraftQueuePanel = lazy(() =>
  import('./DraftQueuePanel').then((mod) => ({ default: mod.DraftQueuePanel })),
);

interface DraftRoomProps {
  pageData: string;
  userTeamId: string;
  mode?: DraftRoomMode;
  mockSessionId?: string;
  draftContext?: DraftContext;
}

function findCurrentPickNumber(picks: DraftRoomPick[]): number {
  const first = picks.find((p) => !p.playerId);
  return first ? first.overallPickNumber : -1;
}

function draftRoomReducer(state: DraftRoomState, action: DraftRoomAction): DraftRoomState {
  switch (action.type) {
    case 'POLL_SUCCESS': {
      const currentPickNumber = findCurrentPickNumber(action.picks);
      const draftComplete = currentPickNumber === -1 && action.picks.length > 0;

      // Auto-advance round if current pick moved to new round
      let activeRound = state.activeRound;
      if (currentPickNumber > 0) {
        const currentPick = action.picks.find((p) => p.overallPickNumber === currentPickNumber);
        if (currentPick && currentPick.round !== state.activeRound) {
          activeRound = currentPick.round;
        }
      }

      // Purge drafted players from queue
      const newlyDraftedIds = new Set(action.picks.filter((p) => p.playerId).map((p) => p.playerId));
      const updatedQueue = state.queue.filter((i) => !newlyDraftedIds.has(i.playerId));
      if (updatedQueue.length !== state.queue.length) {
        saveQueue(state.leagueId, state.leagueYear, updatedQueue);
      }

      return {
        ...state,
        picks: action.picks,
        queue: updatedQueue,
        currentPickNumber,
        draftComplete,
        activeRound,
        lastPollTimestamp: Date.now(),
        pollError: null,
      };
    }
    case 'POLL_ERROR':
      return { ...state, pollError: action.error };
    case 'SET_ACTIVE_ROUND':
      return { ...state, activeRound: action.round };
    case 'SET_MOBILE_TAB':
      return {
        ...state,
        activeMobileTab: action.tab,
        chatUnread: action.tab === 'chat' ? 0 : state.chatUnread,
      };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.query };
    case 'SET_POSITION_FILTER':
      return { ...state, positionFilter: action.position };
    case 'SET_ROOKIES_ONLY':
      return { ...state, rookiesOnly: action.value };
    case 'MOCK_SESSION_SYNC':
      return { ...state, mockSession: action.session };
    case 'MOCK_PICK_MADE':
      return { ...state, mockSession: action.session };
    case 'MOCK_CLOCK_TICK':
      return { ...state, mockClockSeconds: action.secondsRemaining };

    // Queue actions
    case 'LOAD_QUEUE':
      return { ...state, queue: action.items };
    case 'ADD_TO_QUEUE': {
      if (state.queue.some((i) => i.playerId === action.playerId)) return state;
      const newItem: DraftQueueItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        playerId: action.playerId,
        addedAt: Date.now(),
      };
      const updated = [...state.queue, newItem];
      saveQueue(state.leagueId, state.leagueYear, updated);
      return { ...state, queue: updated };
    }
    case 'REMOVE_FROM_QUEUE': {
      const updated = state.queue.filter((i) => i.id !== action.id);
      saveQueue(state.leagueId, state.leagueYear, updated);
      return { ...state, queue: updated };
    }
    case 'REORDER_QUEUE': {
      const updated = state.queue.slice();
      const [moved] = updated.splice(action.oldIndex, 1);
      updated.splice(action.newIndex, 0, moved);
      saveQueue(state.leagueId, state.leagueYear, updated);
      return { ...state, queue: updated };
    }
    case 'TOGGLE_AUTO_SUBMIT':
      return { ...state, autoSubmit: !state.autoSubmit };
    case 'SYNC_QUEUE_START':
      return { ...state, isSyncingQueue: true };
    case 'SYNC_QUEUE_DONE':
      return { ...state, isSyncingQueue: false };
    case 'SUBMIT_PICK_START':
      return { ...state, isSubmittingPick: true, submitError: null };
    case 'SUBMIT_PICK_DONE':
      return { ...state, isSubmittingPick: false };
    case 'SET_SUBMIT_ERROR':
      return { ...state, submitError: action.error, isSubmittingPick: false };

    // Chat actions
    case 'CHAT_HISTORY':
      return { ...state, chatMessages: action.messages };
    case 'CHAT_MESSAGE': {
      const newMessages = [...state.chatMessages, action.message];
      const chatUnread = state.activeMobileTab !== 'chat' && action.message.type !== 'system'
        ? state.chatUnread + 1
        : state.chatUnread;
      return { ...state, chatMessages: newMessages, chatUnread };
    }
    case 'CHAT_REACTION': {
      const chatMessages = state.chatMessages.map((m) =>
        m.id === action.messageId
          ? { ...m, reactions: action.reactions }
          : m
      );
      return { ...state, chatMessages };
    }
    case 'CHAT_CONNECTED':
      return { ...state, chatConnected: true };
    case 'CHAT_DISCONNECTED':
      return { ...state, chatConnected: false };
    case 'CHAT_CLEAR_UNREAD':
      return { ...state, chatUnread: 0 };

    default:
      return state;
  }
}

function initState(data: DraftRoomPageData, draftContext: DraftContext = 'rookie'): DraftRoomState {
  const currentPickNumber = findCurrentPickNumber(data.picks);
  const draftComplete = currentPickNumber === -1 && data.picks.length > 0;
  const currentPick = data.picks.find((p) => p.overallPickNumber === currentPickNumber);

  return {
    picks: data.picks,
    players: data.players,
    teams: data.teams,
    currentPickNumber,
    draftComplete,
    activeRound: currentPick?.round || 1,
    activeMobileTab: 'board',
    searchQuery: '',
    positionFilter: null,
    rookiesOnly: draftContext === 'rookie',
    lastPollTimestamp: Date.now(),
    pollError: null,
    // Queue
    queue: [],
    autoSubmit: false,
    isSyncingQueue: false,
    isSubmittingPick: false,
    submitError: null,
    // Chat
    chatMessages: [],
    chatConnected: false,
    chatUnread: 0,
    // Config
    draftKind: data.draftKind,
    draftLimitHours: data.draftLimitHours,
    draftTimerSusp: data.draftTimerSusp,
    totalRounds: data.totalRounds,
    picksPerRound: data.picksPerRound,
    leagueYear: data.leagueYear,
    leagueId: data.leagueId,
    // Mock draft
    mockSession: null,
    mockClockSeconds: 0,
  };
}

// ── DraftRoom Component ──────────────────────────────────────────────────────

export default function DraftRoom({ pageData, userTeamId, mode = 'live', mockSessionId, draftContext = 'rookie' }: DraftRoomProps) {
  const data: DraftRoomPageData = useMemo(() => JSON.parse(pageData), [pageData]);
  const [state, dispatch] = useReducer(
    draftRoomReducer,
    undefined,
    () => initState(data, draftContext)
  );

  // ── Mock draft WebSocket ──
  const isMock = mode === 'mock';
  const { send: mockSend } = useMockDraftSocket({
    partyHost: data.partyHost,
    sessionId: mockSessionId || '',
    franchiseId: userTeamId,
    dispatch,
    enabled: isMock,
  });

  // Player lookup map
  const playerMap = useMemo(
    () => new Map(state.players.map((p) => [p.id, p])),
    [state.players]
  );

  // Team lookup map
  const teamMap = useMemo(
    () => new Map(state.teams.map((t) => [t.franchiseId, t])),
    [state.teams]
  );

  // User's team info (for chat identity)
  const userTeam = useMemo(() => teamMap.get(userTeamId) || null, [teamMap, userTeamId]);

  // Current pick and team
  const currentPick = useMemo(
    () => state.picks.find((p) => p.overallPickNumber === state.currentPickNumber) || null,
    [state.picks, state.currentPickNumber]
  );
  const currentTeam = currentPick ? teamMap.get(currentPick.franchiseId) || null : null;

  // Is it the user's turn?
  // Live: only when the on-clock pick is for the user's franchise.
  // Mock: the creator is authorised to pick for any team (server auto-picks
  //   franchises whose real owner isn't connected; this keeps the creator
  //   able to intervene if the server hasn't caught up or an override is
  //   wanted).
  const isUserTurn = isMock
    ? !!(currentPick && !state.draftComplete)
    : !!(currentPick && userTeamId && currentPick.franchiseId === userTeamId);

  // Previous pick for timer calculation
  const previousPick = useMemo(() => {
    if (!currentPick) return null;
    const sorted = [...state.picks]
      .filter((p) => !!p.playerId)
      .sort((a, b) => b.overallPickNumber - a.overallPickNumber);
    return sorted[0] || null;
  }, [state.picks, currentPick]);

  // Screen reader announcement for new picks
  const [announcement, setAnnouncement] = useState('');
  const prevPickNumberRef = useRef(state.currentPickNumber);

  // Which destructive action is currently awaiting confirmation. Null when
  // nothing is pending. Only used in mock mode.
  const [pendingAction, setPendingAction] = useState<null | 'reset' | 'goback'>(null);

  const hasUndoablePick = state.picks.some((p) => !!p.playerId);
  const isMockPaused = isMock && state.mockSession?.status === 'paused';

  useEffect(() => {
    if (state.currentPickNumber !== prevPickNumberRef.current && prevPickNumberRef.current > 0) {
      const justPicked = state.picks.find(
        (p) => p.overallPickNumber === prevPickNumberRef.current
      );
      if (justPicked?.playerId) {
        const player = playerMap.get(justPicked.playerId);
        const team = teamMap.get(justPicked.franchiseId);
        if (player && team) {
          const pickText = `Pick ${justPicked.round}.${String(justPicked.pickInRound).padStart(2, '0')}: ${team.nameShort} selects ${player.name}, ${player.position}`;
          setAnnouncement(pickText);
          broadcastPickToChat(pickText);
        }
      }
    }
    prevPickNumberRef.current = state.currentPickNumber;
  }, [state.currentPickNumber, state.picks, playerMap, teamMap]);

  // Load queue from localStorage on mount
  useEffect(() => {
    const items = getQueue(state.leagueId, state.leagueYear);
    if (items.length > 0) {
      dispatch({ type: 'LOAD_QUEUE', items });
    }
  }, [state.leagueId, state.leagueYear]);

  // Polling — adaptive interval via self-rescheduling setTimeout (reads ref fresh each tick)
  // Disabled in mock mode — state comes from PartyKit WebSocket instead
  const hasRecentPickRef = useRef(false);
  useEffect(() => {
    if (isMock) return;
    hasRecentPickRef.current = state.picks.some((p) => {
      if (!p.timestamp) return false;
      const ts = parseInt(p.timestamp) * 1000;
      return Date.now() - ts < 30 * 60 * 1000;
    });
  }, [state.picks, isMock]);

  useEffect(() => {
    if (isMock) return; // Mock mode uses WebSocket, not polling

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/draft/status?year=${state.leagueYear}&league=${state.leagueId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result: DraftStatusResponse = await res.json();
        if (active) dispatch({ type: 'POLL_SUCCESS', picks: result.picks });
      } catch (e) {
        if (active) dispatch({ type: 'POLL_ERROR', error: (e as Error).message });
      }

      if (active) {
        const intervalMs = hasRecentPickRef.current ? 12000 : 30000;
        timeoutId = setTimeout(poll, intervalMs);
      }
    };

    timeoutId = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [state.leagueYear, isMock]);

  // Keyboard shortcuts
  // `/` = focus search, 1-6 = position filter, Q = focus queue tab, C = focus chat tab, B = focus board tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          // Allow `/` to still focus search even when not typing
          if (e.key !== '/') return;
        }
      }
      // Ignore when modifier keys are held (avoid hijacking browser shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.draft-room .dr-search-input');
        if (input) input.focus();
        return;
      }

      const posMap: Record<string, string | null> = {
        '1': null, // ALL
        '2': 'QB',
        '3': 'RB',
        '4': 'WR',
        '5': 'TE',
        '6': 'PK',
      };
      if (e.key in posMap) {
        e.preventDefault();
        dispatch({ type: 'SET_POSITION_FILTER', position: posMap[e.key] });
        return;
      }

      const tabMap: Record<string, 'board' | 'players' | 'queue' | 'chat'> = {
        b: 'board',
        p: 'players',
        q: 'queue',
        c: 'chat',
      };
      const keyLower = e.key.toLowerCase();
      if (keyLower in tabMap) {
        e.preventDefault();
        dispatch({ type: 'SET_MOBILE_TAB', tab: tabMap[keyLower] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-submit: when user is on clock + autoSubmit on + queue non-empty
  useEffect(() => {
    if (!state.autoSubmit || !isUserTurn || state.queue.length === 0 || state.isSubmittingPick || state.draftComplete) return;

    const draftedIds = new Set(state.picks.filter((p) => p.playerId).map((p) => p.playerId));
    const topItem = state.queue.find((i) => !draftedIds.has(i.playerId));
    if (!topItem) return;

    if (isMock) {
      // Mock mode: send pick via WebSocket
      mockSend({ type: 'pick', franchiseId: userTeamId, playerId: topItem.playerId });
      dispatch({ type: 'REMOVE_FROM_QUEUE', id: topItem.id });
      return;
    }

    dispatch({ type: 'SUBMIT_PICK_START' });
    fetch('/api/draft/submit-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: topItem.playerId }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (result.success) {
          dispatch({ type: 'REMOVE_FROM_QUEUE', id: topItem.id });
          dispatch({ type: 'SUBMIT_PICK_DONE' });
        } else {
          dispatch({ type: 'SET_SUBMIT_ERROR', error: result.message || 'Failed to submit pick' });
        }
      })
      .catch((e) => {
        dispatch({ type: 'SET_SUBMIT_ERROR', error: (e as Error).message });
      });
  }, [state.autoSubmit, isUserTurn, state.queue, state.isSubmittingPick, state.draftComplete, state.picks, isMock, mockSend, userTeamId]);

  // Sync queue to MFL (no-op in mock mode — queue is local only)
  const handleSyncToMfl = useCallback(async () => {
    if (isMock || state.isSyncingQueue || state.queue.length === 0) return;
    dispatch({ type: 'SYNC_QUEUE_START' });
    try {
      await fetch('/api/draft/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIds: state.queue.map((i) => i.playerId) }),
      });
    } catch {
      // Fire-and-forget — no user-facing error needed
    } finally {
      dispatch({ type: 'SYNC_QUEUE_DONE' });
    }
  }, [state.queue, state.isSyncingQueue, isMock]);

  // Manual pick submission
  const handleSubmitPick = useCallback((playerId: string) => {
    if (state.isSubmittingPick) return;

    if (isMock) {
      // Mock mode: send pick via WebSocket — server validates and broadcasts
      // Send userTeamId (creator) so the server allows picking for any team on the clock
      mockSend({ type: 'pick', franchiseId: userTeamId, playerId });
      return;
    }

    dispatch({ type: 'SUBMIT_PICK_START' });
    fetch('/api/draft/submit-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) {
          dispatch({ type: 'SET_SUBMIT_ERROR', error: result.message || 'Failed to submit pick' });
        } else {
          dispatch({ type: 'SUBMIT_PICK_DONE' });
        }
      })
      .catch((e) => {
        dispatch({ type: 'SET_SUBMIT_ERROR', error: (e as Error).message });
      });
  }, [state.isSubmittingPick, isMock, mockSend, userTeamId]);

  // Callbacks
  const handleRoundChange = useCallback(
    (round: number) => dispatch({ type: 'SET_ACTIVE_ROUND', round }),
    []
  );
  const handleMobileTab = useCallback(
    (tab: 'board' | 'players' | 'queue' | 'chat') => dispatch({ type: 'SET_MOBILE_TAB', tab }),
    []
  );
  const handleSearch = useCallback(
    (query: string) => dispatch({ type: 'SET_SEARCH_QUERY', query }),
    []
  );
  const handlePosFilter = useCallback(
    (position: string | null) => dispatch({ type: 'SET_POSITION_FILTER', position }),
    []
  );
  const handleAddToQueue = useCallback(
    (playerId: string) => dispatch({ type: 'ADD_TO_QUEUE', playerId }),
    []
  );
  const handleRookiesOnly = useCallback(
    (value: boolean) => dispatch({ type: 'SET_ROOKIES_ONLY', value }),
    []
  );
  const handleRemoveFromQueue = useCallback(
    (id: string) => dispatch({ type: 'REMOVE_FROM_QUEUE', id }),
    []
  );
  const handleReorderQueue = useCallback(
    (oldIndex: number, newIndex: number) => dispatch({ type: 'REORDER_QUEUE', oldIndex, newIndex }),
    []
  );
  const handleToggleAutoSubmit = useCallback(
    () => dispatch({ type: 'TOGGLE_AUTO_SUBMIT' }),
    []
  );

  // Chat callbacks
  const handleChatMessage = useCallback(
    (msg: ChatMessage) => dispatch({ type: 'CHAT_MESSAGE', message: msg }),
    []
  );
  const handleChatReaction = useCallback(
    (messageId: string, emoji: string, reactions: Record<string, string[]>) =>
      dispatch({ type: 'CHAT_REACTION', messageId, emoji, reactions }),
    []
  );
  const handleChatConnected = useCallback(() => dispatch({ type: 'CHAT_CONNECTED' }), []);
  const handleChatDisconnected = useCallback(() => dispatch({ type: 'CHAT_DISCONNECTED' }), []);
  const handleChatHistory = useCallback(
    (messages: ChatMessage[]) => dispatch({ type: 'CHAT_HISTORY', messages }),
    []
  );

  const partyRoomId = `league-${state.leagueId}-draft-${state.leagueYear}`;
  const partyHost = data.partyHost || '';

  // Side panel tab — shared between desktop (tab bar under board) and mobile (MobileTabBar).
  // On mobile the full activeMobileTab governs which top-level panel is visible (including 'board');
  // on desktop the board is always visible on top and only players/queue/chat are selectable.
  // Treat 'board' on desktop as "players" (the default content panel).
  const sideTab: 'players' | 'queue' | 'chat' =
    state.activeMobileTab === 'queue' ? 'queue' :
    state.activeMobileTab === 'chat' ? 'chat' :
    'players';
  const setSideTab = useCallback(
    (tab: 'players' | 'queue' | 'chat') => dispatch({ type: 'SET_MOBILE_TAB', tab }),
    []
  );

  // Track first visit to queue/chat so the lazy chunks only load on demand,
  // but stay mounted afterward (preserves DnD sensors, chat socket, scroll pos).
  const [queueVisited, setQueueVisited] = useState(false);
  const [chatVisited, setChatVisited] = useState(false);
  useEffect(() => {
    if (sideTab === 'queue' && !queueVisited) setQueueVisited(true);
    if (sideTab === 'chat' && !chatVisited) setChatVisited(true);
  }, [sideTab, queueVisited, chatVisited]);

  return (
    <div className="draft-room" data-active-mobile-tab={state.activeMobileTab}>
      {/* Screen reader announcements */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <DraftTimerBanner
        currentPick={previousPick ? { ...currentPick!, timestamp: previousPick.timestamp } : currentPick}
        currentTeam={currentTeam}
        draftKind={isMock ? 'live' : state.draftKind}
        draftLimitHours={state.draftLimitHours}
        draftTimerSusp={state.draftTimerSusp}
        draftComplete={state.draftComplete}
        isUserTurn={isUserTurn}
        mockClockSeconds={isMock ? state.mockClockSeconds : undefined}
        actions={isMock ? (
          <>
            <button
              type="button"
              onClick={() => setPendingAction('goback')}
              className="dr-reset-btn"
              disabled={!hasUndoablePick}
              title={hasUndoablePick ? 'Revert the last pick' : 'No pick to go back to'}
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={() =>
                mockSend({
                  type: isMockPaused ? 'resume' : 'pause',
                  franchiseId: userTeamId,
                })
              }
              className="dr-reset-btn"
              title={isMockPaused ? 'Resume the timer' : 'Pause the timer'}
            >
              {isMockPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setPendingAction('reset')}
              className="dr-reset-btn"
            >
              Reset Draft
            </button>
          </>
        ) : undefined}
      />

      {pendingAction === 'reset' && (
        <ConfirmDialog
          title="Reset mock draft?"
          message="Every pick will be cleared and the draft will restart from Pick 1. This cannot be undone."
          confirmLabel="Reset draft"
          destructive
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            mockSend({ type: 'reset', franchiseId: userTeamId });
            setPendingAction(null);
          }}
        />
      )}
      {pendingAction === 'goback' && (
        <ConfirmDialog
          title="Go back one pick?"
          message="The most recent pick will be cleared and that slot will go back on the clock. You can keep pressing Go Back to rewind further."
          confirmLabel="Go back"
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            mockSend({ type: 'undo', franchiseId: userTeamId });
            setPendingAction(null);
          }}
        />
      )}

      <div className="dr-mobile-tabs">
        <MobileTabBar
          activeTab={state.activeMobileTab}
          onTabChange={handleMobileTab}
          chatUnread={state.chatUnread}
          queueCount={state.queue.length}
        />
      </div>

      <div className="dr-main">
        <div
          id="dr-panel-board"
          role="tabpanel"
          aria-labelledby="dr-tab-board"
          className="dr-panel-board"
        >
          <DraftBoardPanel
            picks={state.picks}
            teams={state.teams}
            players={playerMap}
            totalRounds={state.totalRounds}
            picksPerRound={state.picksPerRound}
            currentPickNumber={state.currentPickNumber}
            userTeamId={userTeamId}
            activeRound={state.activeRound}
            onRoundChange={handleRoundChange}
          />
        </div>

        <div className="dr-side-panel" data-side-tab={sideTab}>
          <div role="tablist" aria-label="Side panel tabs" className="dr-side-tab-bar">
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'players'}
              aria-controls="dr-panel-players"
              onClick={() => setSideTab('players')}
              className="dr-side-tab-btn"
            >
              Players
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'queue'}
              aria-controls="dr-panel-queue"
              onClick={() => setSideTab('queue')}
              className="dr-side-tab-btn"
            >
              Queue{state.queue.length > 0 ? ` (${state.queue.length})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'chat'}
              aria-controls="dr-panel-chat"
              onClick={() => setSideTab('chat')}
              className="dr-side-tab-btn"
            >
              Chat{state.chatUnread > 0 ? ` (${state.chatUnread})` : ''}
            </button>
          </div>

          <div
            id="dr-panel-players"
            role="tabpanel"
            aria-labelledby="dr-tab-players"
            className="dr-panel-players"
          >
            <PlayerPoolPanel
              players={state.players}
              picks={state.picks}
              queue={state.queue}
              searchQuery={state.searchQuery}
              positionFilter={state.positionFilter}
              onSearchChange={handleSearch}
              onPositionFilterChange={handlePosFilter}
              onAddToQueue={handleAddToQueue}
              rookiesOnly={state.rookiesOnly}
              onRookiesOnlyChange={handleRookiesOnly}
              draftContext={draftContext}
              isUserTurn={isUserTurn}
              onSubmitPick={handleSubmitPick}
              currentPick={currentPick}
            />
          </div>

          <div
            id="dr-panel-queue"
            role="tabpanel"
            aria-labelledby="dr-tab-queue"
            className="dr-panel-queue"
          >
            {queueVisited ? (
              <Suspense fallback={<div className="dr-panel-loading">Loading queue…</div>}>
                <DraftQueuePanel
                  queue={state.queue}
                  players={playerMap}
                  picks={state.picks}
                  isUserTurn={isUserTurn}
                  autoSubmit={state.autoSubmit}
                  isSyncingQueue={state.isSyncingQueue}
                  isSubmittingPick={state.isSubmittingPick}
                  submitError={state.submitError}
                  onReorder={handleReorderQueue}
                  onRemove={handleRemoveFromQueue}
                  onSyncToMfl={handleSyncToMfl}
                  onSubmitPick={handleSubmitPick}
                  onToggleAutoSubmit={handleToggleAutoSubmit}
                />
              </Suspense>
            ) : null}
          </div>

          <div
            id="dr-panel-chat"
            role="tabpanel"
            aria-labelledby="dr-tab-chat"
            className="dr-panel-chat"
          >
            {chatVisited && partyHost ? (
              <DraftChatPanel
                partyHost={partyHost}
                roomId={partyRoomId}
                franchiseId={userTeamId}
                franchiseName={userTeam?.nameShort || userTeam?.name || 'Owner'}
                franchiseIcon={userTeam?.icon || ''}
                teams={state.teams}
                messages={state.chatMessages}
                connected={state.chatConnected}
                onMessage={handleChatMessage}
                onReaction={handleChatReaction}
                onConnected={handleChatConnected}
                onDisconnected={handleChatDisconnected}
                onHistory={handleChatHistory}
              />
            ) : chatVisited ? (
              <div className="dr-chat-missing">
                <div>
                  <span className="dr-chat-missing__icon" aria-hidden="true">💬</span>
                  Chat requires PartyKit.<br />Set PUBLIC_PARTYKIT_HOST.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {state.pollError && (
        <div className="dr-poll-error" role="status">
          Connection issue — retrying...
        </div>
      )}
    </div>
  );
}
