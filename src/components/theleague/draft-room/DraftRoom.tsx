import React, { useReducer, useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type {
  DraftRoomPageData,
  DraftRoomState,
  DraftRoomAction,
  DraftRoomPick,
  DraftRoomPlayer,
  DraftQueueItem,
  DraftStatusResponse,
  ChatMessage,
} from '../../../types/draft-room';
import { DraftTimerBanner } from './DraftTimerBanner';
import { DraftBoardPanel } from './DraftBoardPanel';
import { PlayerPoolPanel } from './PlayerPoolPanel';
import { DraftQueuePanel } from './DraftQueuePanel';
import { MobileTabBar } from './MobileTabBar';
import { DraftChatPanel, broadcastPickToChat } from './DraftChatPanel';
import { getQueue, saveQueue } from '../../../utils/draft-queue-storage';
import '../../../styles/draft-room.css';

interface DraftRoomProps {
  pageData: string;
  userTeamId: string;
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
      const updated = arrayMove(state.queue, action.oldIndex, action.newIndex);
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

function initState(data: DraftRoomPageData): DraftRoomState {
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
  };
}

export default function DraftRoom({ pageData, userTeamId }: DraftRoomProps) {
  const data: DraftRoomPageData = useMemo(() => JSON.parse(pageData), [pageData]);
  const [state, dispatch] = useReducer(draftRoomReducer, data, initState);

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
  const isUserTurn = !!(currentPick && userTeamId && currentPick.franchiseId === userTeamId);

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
  const hasRecentPickRef = useRef(false);
  useEffect(() => {
    hasRecentPickRef.current = state.picks.some((p) => {
      if (!p.timestamp) return false;
      const ts = parseInt(p.timestamp) * 1000;
      return Date.now() - ts < 30 * 60 * 1000;
    });
  }, [state.picks]);

  useEffect(() => {
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
  }, [state.leagueYear]);

  // Auto-submit: when user is on clock + autoSubmit on + queue non-empty
  useEffect(() => {
    if (!state.autoSubmit || !isUserTurn || state.queue.length === 0 || state.isSubmittingPick || state.draftComplete) return;

    const draftedIds = new Set(state.picks.filter((p) => p.playerId).map((p) => p.playerId));
    const topItem = state.queue.find((i) => !draftedIds.has(i.playerId));
    if (!topItem) return;

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
  }, [state.autoSubmit, isUserTurn, state.queue, state.isSubmittingPick, state.draftComplete, state.picks]);

  // Sync queue to MFL
  const handleSyncToMfl = useCallback(async () => {
    if (state.isSyncingQueue || state.queue.length === 0) return;
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
  }, [state.queue, state.isSyncingQueue]);

  // Manual pick submission
  const handleSubmitPick = useCallback((playerId: string) => {
    if (state.isSubmittingPick) return;
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
  }, [state.isSubmittingPick]);

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

  return (
    <div className="draft-room" style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - var(--header-height, 60px))',
      overflow: 'hidden',
    }}>
      {/* Screen reader announcements */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Timer Banner */}
      <DraftTimerBanner
        currentPick={previousPick ? { ...currentPick!, timestamp: previousPick.timestamp } : currentPick}
        currentTeam={currentTeam}
        draftKind={state.draftKind}
        draftLimitHours={state.draftLimitHours}
        draftTimerSusp={state.draftTimerSusp}
        draftComplete={state.draftComplete}
      />

      {/* Mobile Tab Bar */}
      <div className="dr-mobile-tabs">
        <MobileTabBar
          activeTab={state.activeMobileTab}
          onTabChange={handleMobileTab}
          chatUnread={state.chatUnread}
          queueCount={state.queue.length}
        />
      </div>

      {/* Main content area — desktop: 4-col grid */}
      <div className="dr-main" style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '2fr 1.2fr 1fr 1fr',
        gap: '1px',
        background: 'var(--content-border, #e2e8f0)',
        overflow: 'hidden',
      }}>
        {/* Board panel */}
        <div
          id="dr-panel-board"
          role="tabpanel"
          aria-labelledby="dr-tab-board"
          className="dr-panel-board"
          style={{ background: 'var(--content-bg, #ffffff)', overflow: 'hidden' }}
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

        {/* Player pool panel */}
        <div
          id="dr-panel-players"
          role="tabpanel"
          aria-labelledby="dr-tab-players"
          className="dr-panel-players"
          style={{ background: 'var(--content-bg, #ffffff)', overflow: 'hidden' }}
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
          />
        </div>

        {/* Queue panel */}
        <div
          id="dr-panel-queue"
          role="tabpanel"
          aria-labelledby="dr-tab-queue"
          className="dr-panel-queue"
          style={{ background: 'var(--content-bg, #ffffff)', overflow: 'hidden' }}
        >
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
        </div>

        {/* Chat panel */}
        <div
          id="dr-panel-chat"
          role="tabpanel"
          aria-labelledby="dr-tab-chat"
          className="dr-panel-chat"
          style={{ background: 'var(--content-bg, #ffffff)', overflow: 'hidden' }}
        >
          {partyHost ? (
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
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '1rem', textAlign: 'center', color: 'var(--color-gray-400, #9ca3af)', fontSize: '0.8125rem' }}>
              <div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💬</div>
                Chat requires PartyKit.<br />Set PUBLIC_PARTYKIT_HOST.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Poll error indicator */}
      {state.pollError && (
        <div style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          background: 'var(--color-error-light, #fee2e2)',
          color: 'var(--color-error-dark, #b91c1c)',
          padding: '0.5rem 0.75rem',
          borderRadius: 'var(--radius-md, 0.5rem)',
          fontSize: '0.75rem',
          fontWeight: 500,
          boxShadow: 'var(--shadow-md)',
          zIndex: 50,
        }}>
          Connection issue — retrying...
        </div>
      )}

      <style>{`
        .dr-mobile-tabs {
          display: none;
        }
        @media (max-width: 767px) {
          .dr-mobile-tabs {
            display: block;
          }
          .dr-main {
            grid-template-columns: 1fr !important;
          }
          .dr-panel-board {
            display: ${state.activeMobileTab === 'board' ? 'block' : 'none'};
          }
          .dr-panel-players {
            display: ${state.activeMobileTab === 'players' ? 'block' : 'none'};
          }
          .dr-panel-queue {
            display: ${state.activeMobileTab === 'queue' ? 'block' : 'none'};
          }
          .dr-panel-chat {
            display: ${state.activeMobileTab === 'chat' ? 'block' : 'none'};
          }
        }
        /* Tablet: 2-col (board + players), hide queue + chat */
        @media (min-width: 768px) and (max-width: 1199px) {
          .dr-main {
            grid-template-columns: 3fr 2fr !important;
          }
          .dr-panel-queue {
            display: none !important;
          }
          .dr-panel-chat {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
