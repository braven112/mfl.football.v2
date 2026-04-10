import React, { useReducer, useMemo, useCallback, useEffect, useState, useRef } from 'react';
import type {
  TradeBuilderPageData,
  TradeState,
  TradeAction,
  TradeSide,
  DraftPickKey,
  DraftTrade,
  TradeBuilderAuthUser,
  TradeSubmissionState,
  PendingTrade,
} from '../../../types/trade-builder';
import {
  computeTeamTradeImpact,
  serializeTradeToParams,
  deserializeTradeFromParams,
} from '../../../utils/trade-calculations';
import { buildMflAssetString, parseFpCode } from '../../../utils/trade-asset-parsing';
import TeamPanel from './TeamPanel';
import TradeBaitMarketplace from './TradeBaitMarketplace';
import MultiYearCapTable from './MultiYearCapTable';
import TradeAnalysisSummary from './TradeAnalysisSummary';
import TradeValueAnalysis from './TradeValueAnalysis';
import RookieExtensionModal from './RookieExtensionModal';
import TradeConfirmationModal from './TradeConfirmationModal';
import PendingTradesPanel from './PendingTradesPanel';
import LoginModal from './LoginModal';

const EMPTY_SIDE: TradeSide = {
  franchiseId: null,
  playerIds: [],
  draftPicks: [],
  rookieExtensions: {},
};

function tradeReducer(state: TradeState, action: TradeAction): TradeState {
  const getSide = (side: 'A' | 'B') =>
    side === 'A' ? state.teamA : state.teamB;
  const setSide = (side: 'A' | 'B', data: TradeSide) =>
    side === 'A' ? { ...state, teamA: data } : { ...state, teamB: data };

  switch (action.type) {
    case 'SET_TEAM': {
      const otherSide = action.side === 'A' ? 'B' : 'A';
      const otherFranchise = getSide(otherSide).franchiseId;
      if (action.franchiseId === otherFranchise) return state;
      return setSide(action.side, {
        ...EMPTY_SIDE,
        franchiseId: action.franchiseId,
      });
    }
    case 'ADD_PLAYER': {
      const side = getSide(action.side);
      if (side.playerIds.includes(action.playerId)) return state;
      return setSide(action.side, {
        ...side,
        playerIds: [...side.playerIds, action.playerId],
      });
    }
    case 'REMOVE_PLAYER': {
      const side = getSide(action.side);
      const { [action.playerId]: _, ...remainingExtensions } =
        side.rookieExtensions;
      return setSide(action.side, {
        ...side,
        playerIds: side.playerIds.filter((id) => id !== action.playerId),
        rookieExtensions: remainingExtensions,
      });
    }
    case 'ADD_DRAFT_PICK': {
      const side = getSide(action.side);
      const exists = side.draftPicks.some(
        (p) =>
          p.year === action.pick.year &&
          p.round === action.pick.round &&
          p.originalPickFor === action.pick.originalPickFor
      );
      if (exists) return state;
      return setSide(action.side, {
        ...side,
        draftPicks: [...side.draftPicks, action.pick],
      });
    }
    case 'REMOVE_DRAFT_PICK': {
      const side = getSide(action.side);
      return setSide(action.side, {
        ...side,
        draftPicks: side.draftPicks.filter(
          (p) =>
            !(
              p.year === action.pick.year &&
              p.round === action.pick.round &&
              p.originalPickFor === action.pick.originalPickFor
            )
        ),
      });
    }
    case 'SET_ROOKIE_EXTENSION': {
      const side = getSide(action.side);
      return setSide(action.side, {
        ...side,
        rookieExtensions: {
          ...side.rookieExtensions,
          [action.playerId]: action.sim,
        },
      });
    }
    case 'CLEAR_ROOKIE_EXTENSION': {
      const side = getSide(action.side);
      const { [action.playerId]: _, ...rest } = side.rookieExtensions;
      return setSide(action.side, { ...side, rookieExtensions: rest });
    }
    case 'SHOW_ROOKIE_MODAL':
      return {
        ...state,
        rookieModalTarget: {
          playerId: action.playerId,
          side: action.side,
        },
      };
    case 'HIDE_ROOKIE_MODAL':
      return { ...state, rookieModalTarget: null };
    case 'SWAP_TEAMS':
      return { ...state, teamA: state.teamB, teamB: state.teamA };
    case 'RESET':
      return {
        teamA: { ...EMPTY_SIDE, franchiseId: state.teamA.franchiseId },
        teamB: { ...EMPTY_SIDE, franchiseId: state.teamB.franchiseId },
        rookieModalTarget: null,
      };
    case 'LOAD_DRAFT':
      return {
        teamA: action.teamA,
        teamB: action.teamB,
        rookieModalTarget: null,
      };
    case 'START_TRADE_FOR_PLAYER': {
      const targetFranchise = action.franchiseId;
      const currentA = state.teamA.franchiseId;
      const currentB = state.teamB.franchiseId;

      if (targetFranchise === currentA) {
        return {
          ...state,
          teamA: { ...state.teamB },
          teamB: {
            ...state.teamA,
            playerIds: state.teamA.playerIds.includes(action.playerId)
              ? state.teamA.playerIds
              : [...state.teamA.playerIds, action.playerId],
          },
          rookieModalTarget: null,
        };
      }

      if (targetFranchise === currentB) {
        return {
          ...state,
          teamB: {
            ...state.teamB,
            playerIds: state.teamB.playerIds.includes(action.playerId)
              ? state.teamB.playerIds
              : [...state.teamB.playerIds, action.playerId],
          },
        };
      }

      return {
        ...state,
        teamB: {
          ...EMPTY_SIDE,
          franchiseId: targetFranchise,
          playerIds: [action.playerId],
        },
        rookieModalTarget: null,
      };
    }
    default:
      return state;
  }
}

interface Props {
  pageData: string;
  defaultTeamId: string;
  authUser?: string;
}

export default function TradeBuilder({ pageData, defaultTeamId, authUser: authUserJson }: Props) {
  const data: TradeBuilderPageData = useMemo(
    () => JSON.parse(pageData),
    [pageData]
  );

  const [authUser, setAuthUser] = useState<TradeBuilderAuthUser | null>(
    () => (authUserJson ? JSON.parse(authUserJson) : null)
  );

  // Hydrate authUser from session cookie if server didn't provide it
  // (happens with client-side navigation via ViewTransitions)
  useEffect(() => {
    if (authUser) return;
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.authenticated && data.user?.franchiseId) {
          setAuthUser({
            name: data.user.username,
            franchiseId: data.user.franchiseId,
            leagueId: data.user.leagueId,
            role: data.user.role,
          });
        }
      })
      .catch(() => {}); // Silent — user just isn't logged in
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for focus return
  const submitBtnRef = useRef<HTMLButtonElement>(null);

  // UI state for submission flow
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<TradeSubmissionState>({
    status: 'idle',
    errorMessage: null,
  });

  // Initialize from URL params or defaults
  const initialState = useMemo((): TradeState => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const restored = deserializeTradeFromParams(params);
      if (restored.teamAId || restored.teamBId) {
        return {
          teamA: {
            franchiseId: restored.teamAId,
            playerIds: restored.teamAPlayerIds,
            draftPicks: restored.teamADraftPicks,
            rookieExtensions: {},
          },
          teamB: {
            franchiseId: restored.teamBId,
            playerIds: restored.teamBPlayerIds,
            draftPicks: restored.teamBDraftPicks,
            rookieExtensions: {},
          },
          rookieModalTarget: null,
        };
      }
    }

    // No user preference — pick the 2 teams with the most cap room
    if (!defaultTeamId && data.teams.length >= 2) {
      const byCapSpace = [...data.teams].sort(
        (a, b) => b.currentCapSpace - a.currentCapSpace
      );
      return {
        teamA: { ...EMPTY_SIDE, franchiseId: byCapSpace[0].franchiseId },
        teamB: { ...EMPTY_SIDE, franchiseId: byCapSpace[1].franchiseId },
        rookieModalTarget: null,
      };
    }

    return {
      teamA: { ...EMPTY_SIDE, franchiseId: defaultTeamId || null },
      teamB: { ...EMPTY_SIDE },
      rookieModalTarget: null,
    };
  }, [defaultTeamId, data.teams]);

  const [state, dispatch] = useReducer(tradeReducer, initialState);

  // Team data lookups
  const teamA = useMemo(
    () => data.teams.find((t) => t.franchiseId === state.teamA.franchiseId),
    [data, state.teamA.franchiseId]
  );
  const teamB = useMemo(
    () => data.teams.find((t) => t.franchiseId === state.teamB.franchiseId),
    [data, state.teamB.franchiseId]
  );

  // Get selected players
  const teamAPlayers = useMemo(
    () =>
      teamA?.players.filter((p) => state.teamA.playerIds.includes(p.id)) ?? [],
    [teamA, state.teamA.playerIds]
  );
  const teamBPlayers = useMemo(
    () =>
      teamB?.players.filter((p) => state.teamB.playerIds.includes(p.id)) ?? [],
    [teamB, state.teamB.playerIds]
  );

  // Compute trade impact
  const tradeImpactA = useMemo(() => {
    if (!teamA || (teamAPlayers.length === 0 && teamBPlayers.length === 0))
      return null;
    return computeTeamTradeImpact(
      teamA,
      teamAPlayers,
      teamBPlayers,
      state.teamA.rookieExtensions
    );
  }, [teamA, teamAPlayers, teamBPlayers, state.teamA.rookieExtensions]);

  const tradeImpactB = useMemo(() => {
    if (!teamB || (teamAPlayers.length === 0 && teamBPlayers.length === 0))
      return null;
    return computeTeamTradeImpact(
      teamB,
      teamBPlayers,
      teamAPlayers,
      state.teamB.rookieExtensions
    );
  }, [teamB, teamAPlayers, teamBPlayers, state.teamB.rookieExtensions]);

  const hasTrade =
    teamAPlayers.length > 0 ||
    teamBPlayers.length > 0 ||
    state.teamA.draftPicks.length > 0 ||
    state.teamB.draftPicks.length > 0;

  // Both sides need at least one asset for a valid trade
  const hasValidTrade =
    (teamAPlayers.length > 0 || state.teamA.draftPicks.length > 0) &&
    (teamBPlayers.length > 0 || state.teamB.draftPicks.length > 0);

  // Check if the auth user's franchise is part of the trade
  const userIsPartOfTrade =
    authUser &&
    (state.teamA.franchiseId === authUser.franchiseId ||
      state.teamB.franchiseId === authUser.franchiseId);

  // Determine which team the user is (for orienting the submission)
  const userSide: 'A' | 'B' | null = useMemo(() => {
    if (!authUser) return null;
    if (state.teamA.franchiseId === authUser.franchiseId) return 'A';
    if (state.teamB.franchiseId === authUser.franchiseId) return 'B';
    return null;
  }, [authUser, state.teamA.franchiseId, state.teamB.franchiseId]);

  // Copy share link
  const handleCopyLink = useCallback(() => {
    const params = serializeTradeToParams({
      teamAId: state.teamA.franchiseId,
      teamBId: state.teamB.franchiseId,
      teamAPlayerIds: state.teamA.playerIds,
      teamBPlayerIds: state.teamB.playerIds,
      teamADraftPicks: state.teamA.draftPicks,
      teamBDraftPicks: state.teamB.draftPicks,
    });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard.writeText(url);
  }, [state]);

  // Update URL when trade changes
  useEffect(() => {
    if (!hasTrade) return;
    const params = serializeTradeToParams({
      teamAId: state.teamA.franchiseId,
      teamBId: state.teamB.franchiseId,
      teamAPlayerIds: state.teamA.playerIds,
      teamBPlayerIds: state.teamB.playerIds,
      teamADraftPicks: state.teamA.draftPicks,
      teamBDraftPicks: state.teamB.draftPicks,
    });
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [state.teamA, state.teamB, hasTrade]);

  // Rookie modal target player
  const rookieModalPlayer = useMemo(() => {
    if (!state.rookieModalTarget) return null;
    const { playerId, side } = state.rookieModalTarget;
    const team = side === 'A' ? teamA : teamB;
    return team?.players.find((p) => p.id === playerId) ?? null;
  }, [state.rookieModalTarget, teamA, teamB]);

  // Handle submit trade click
  const handleSubmitTradeClick = useCallback(() => {
    if (!authUser) {
      setShowLoginModal(true);
      return;
    }
    setSubmissionStatus({ status: 'idle', errorMessage: null });
    setShowConfirmationModal(true);
  }, [authUser]);

  // Handle successful inline login
  const handleLoginSuccess = useCallback((user: TradeBuilderAuthUser) => {
    setAuthUser(user);
    setShowLoginModal(false);
    // Immediately open the confirmation modal now that we're authenticated
    setSubmissionStatus({ status: 'idle', errorMessage: null });
    setShowConfirmationModal(true);
  }, []);

  // Submit trade to MFL
  const handleSubmitTrade = useCallback(async (message: string) => {
    if (!teamA || !teamB) return;

    // Determine which side the authenticated user is on.
    // 1. Match authUser.franchiseId against trade sides
    // 2. Match defaultTeamId (cookie preference) — handles commissioner "0000"
    // 3. Default to Team A — convention is "your team on the left".
    //    MFL validates server-side that the cookie holder can propose this trade.
    const currentUserSide = (() => {
      const fA = state.teamA.franchiseId;
      const fB = state.teamB.franchiseId;
      const userFid = authUser?.franchiseId;
      if (userFid && userFid === fA) return 'A' as const;
      if (userFid && userFid === fB) return 'B' as const;
      if (defaultTeamId && defaultTeamId === fA) return 'A' as const;
      if (defaultTeamId && defaultTeamId === fB) return 'B' as const;
      // Last resort: assume Team A (left side). MFL will reject if wrong.
      return 'A' as const;
    })();

    setSubmissionStatus({ status: 'submitting', errorMessage: null });

    // The user's side gives up their assets, receives the other side's assets
    const userTeamSide = currentUserSide === 'A' ? state.teamA : state.teamB;
    const otherTeamSide = currentUserSide === 'A' ? state.teamB : state.teamA;
    const otherTeam = currentUserSide === 'A' ? teamB : teamA;

    const willGiveUp = buildMflAssetString(userTeamSide.playerIds, userTeamSide.draftPicks);
    const willReceive = buildMflAssetString(otherTeamSide.playerIds, otherTeamSide.draftPicks);

    try {
      const res = await fetch('/api/trades/submit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeredTo: otherTeam.franchiseId,
          willGiveUp,
          willReceive,
          comments: message || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSubmissionStatus({ status: 'success', errorMessage: null });
      } else {
        setSubmissionStatus({
          status: 'error',
          errorMessage: data.message || 'Failed to submit trade',
        });
      }
    } catch {
      setSubmissionStatus({
        status: 'error',
        errorMessage: 'Network error. Please try again.',
      });
    }
  }, [authUser, defaultTeamId, state.teamA, state.teamB, teamA, teamB]);

  // ---------------------------------------------------------------------------
  // Draft Trades (server-persisted via /api/trades/drafts)
  // ---------------------------------------------------------------------------
  const [drafts, setDrafts] = useState<DraftTrade[]>([]);

  // Fetch drafts from server when panel opens or auth changes
  const fetchDrafts = useCallback(async () => {
    if (!authUser) { setDrafts([]); return; }
    try {
      const res = await fetch('/api/trades/drafts', { credentials: 'include' });
      const json = await res.json();
      if (json.drafts) setDrafts(json.drafts);
    } catch { /* silent — drafts are non-critical */ }
  }, [authUser]);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const handleSaveDraft = useCallback(async () => {
    if (!authUser) {
      setShowLoginModal(true);
      return;
    }
    const teamAData = data.teams.find(t => t.franchiseId === state.teamA.franchiseId);
    const teamBData = data.teams.find(t => t.franchiseId === state.teamB.franchiseId);
    const nameA = teamAData?.abbrev ?? 'Team A';
    const nameB = teamBData?.abbrev ?? 'Team B';
    const now = Date.now();
    const draft: DraftTrade = {
      id: `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${nameA} / ${nameB}`,
      createdAt: now,
      updatedAt: now,
      teamA: { ...state.teamA },
      teamB: { ...state.teamB },
    };
    try {
      const res = await fetch('/api/trades/drafts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (json.drafts) setDrafts(json.drafts);
    } catch { /* silent */ }
  }, [authUser, state.teamA, state.teamB, data.teams]);

  const handleLoadDraft = useCallback((draft: DraftTrade) => {
    setSubmissionStatus({ status: 'idle', errorMessage: null });
    dispatch({ type: 'LOAD_DRAFT', teamA: draft.teamA, teamB: draft.teamB });
  }, []);

  const handleDeleteDraft = useCallback(async (draftId: string) => {
    try {
      const res = await fetch(`/api/trades/drafts?id=${encodeURIComponent(draftId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.drafts) setDrafts(json.drafts);
    } catch { /* silent */ }
  }, []);

  const handleRenameDraft = useCallback(async (draftId: string, name: string) => {
    try {
      const res = await fetch('/api/trades/drafts', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, name }),
      });
      const json = await res.json();
      if (json.drafts) setDrafts(json.drafts);
    } catch { /* silent */ }
  }, []);

  // Load a pending trade into the builder
  const handleLoadTradeIntoBuilder = useCallback((trade: PendingTrade, _mode: 'counter' | 'view') => {
    // Reset any prior submission state
    setSubmissionStatus({ status: 'idle', errorMessage: null });
    // Set teams
    dispatch({ type: 'SET_TEAM', side: 'A', franchiseId: trade.offeredBy });
    dispatch({ type: 'SET_TEAM', side: 'B', franchiseId: trade.offeredTo });

    // Parse and add assets using shared utility
    const parseAndLoad = (assetStr: string, side: 'A' | 'B') => {
      if (!assetStr) return;
      const parts = assetStr.split(',').filter(Boolean);
      for (const part of parts) {
        const trimmed = part.trim();
        const pick = parseFpCode(trimmed);
        if (pick) {
          dispatch({ type: 'ADD_DRAFT_PICK', side, pick });
        } else if (/^\d+$/.test(trimmed)) {
          dispatch({ type: 'ADD_PLAYER', side, playerId: trimmed });
        }
      }
    };

    // willGiveUp = what offeredBy gives, willReceive = what offeredTo gives
    parseAndLoad(trade.willGiveUp, 'A');
    parseAndLoad(trade.willReceive, 'B');
  }, []);

  return (
    <div className="trade-builder">
      <div className="trade-builder__header">
        <h1>Trade Builder</h1>
        <div className="trade-builder__actions">
          <button
            className="btn btn--secondary"
            onClick={() => dispatch({ type: 'RESET' })}
            disabled={!hasTrade}
          >
            Reset
          </button>
          <button
            className="btn btn--secondary"
            onClick={handleCopyLink}
            disabled={!hasTrade}
          >
            Copy Link
          </button>
          {hasTrade && (
            <button
              className="btn btn--secondary"
              onClick={handleSaveDraft}
            >
              Save Draft
            </button>
          )}
          {authUser && (
            <button
              className="btn btn--secondary"
              onClick={() => { fetchDrafts(); setShowPendingPanel(true); }}
            >
              My Trades
            </button>
          )}
          {hasValidTrade && (
            <button
              ref={submitBtnRef}
              className="btn btn--primary"
              onClick={handleSubmitTradeClick}
            >
              Submit Trade
            </button>
          )}
        </div>
      </div>

      <div className="trade-builder__panels">
        <TeamPanel
          side="A"
          teams={data.teams}
          selectedTeam={teamA ?? null}
          tradeSide={state.teamA}
          otherSideFranchiseId={state.teamB.franchiseId}
          tradeImpact={tradeImpactA}
          salaryYears={data.salaryYears}
          salaryCap={data.salaryCap}
          dispatch={dispatch}
        />

        <div className="trade-builder__divider">
          <button
            className="trade-builder__swap"
            onClick={() => dispatch({ type: 'SWAP_TEAMS' })}
            title="Swap teams"
            aria-label="Swap teams"
          >
            &#8644;
          </button>
        </div>

        <TeamPanel
          side="B"
          teams={data.teams}
          selectedTeam={teamB ?? null}
          tradeSide={state.teamB}
          otherSideFranchiseId={state.teamA.franchiseId}
          tradeImpact={tradeImpactB}
          salaryYears={data.salaryYears}
          salaryCap={data.salaryCap}
          dispatch={dispatch}
        />
      </div>

      {hasTrade && tradeImpactA && tradeImpactB && teamA && teamB && (
        <>
          {data.surplusMap && Object.keys(data.surplusMap).length > 0 && (
            <TradeValueAnalysis
              teamAName={teamA.nameMedium}
              teamBName={teamB.nameMedium}
              teamAIcon={teamA.icon}
              teamBIcon={teamB.icon}
              teamAPlayers={teamAPlayers}
              teamBPlayers={teamBPlayers}
              teamADraftPicks={state.teamA.draftPicks}
              teamBDraftPicks={state.teamB.draftPicks}
              surplusMap={data.surplusMap}
              pickValueMap={data.pickValueMap}
            />
          )}
          <MultiYearCapTable
            teamAName={teamA.nameMedium}
            teamBName={teamB.nameMedium}
            teamAIcon={teamA.icon}
            teamBIcon={teamB.icon}
            impactA={tradeImpactA}
            impactB={tradeImpactB}
            salaryYears={data.salaryYears}
          />
          <TradeAnalysisSummary
            teamAName={teamA.nameMedium}
            teamBName={teamB.nameMedium}
            teamAIcon={teamA.icon}
            teamBIcon={teamB.icon}
            teamAPlayers={teamAPlayers}
            teamBPlayers={teamBPlayers}
            impactA={tradeImpactA}
            impactB={tradeImpactB}
            salaryCap={data.salaryCap}
          />
        </>
      )}

      <TradeBaitMarketplace
        teams={data.teams}
        leagueYear={data.leagueYear}
        onStartTrade={(franchiseId, playerId) =>
          dispatch({ type: 'START_TRADE_FOR_PLAYER', franchiseId, playerId })
        }
      />

      {state.rookieModalTarget && rookieModalPlayer && (
        <RookieExtensionModal
          player={rookieModalPlayer}
          side={state.rookieModalTarget.side}
          positionAverages={data.positionAverages}
          onApply={(sim) => {
            dispatch({
              type: 'SET_ROOKIE_EXTENSION',
              side: state.rookieModalTarget!.side,
              playerId: state.rookieModalTarget!.playerId,
              sim,
            });
            dispatch({ type: 'HIDE_ROOKIE_MODAL' });
          }}
          onClose={() => dispatch({ type: 'HIDE_ROOKIE_MODAL' })}
        />
      )}

      {showLoginModal && !authUser && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      )}

      {showConfirmationModal && teamA && teamB && tradeImpactA && tradeImpactB && (
        <TradeConfirmationModal
          teamA={teamA}
          teamB={teamB}
          allTeams={data.teams}
          teamAPlayers={teamAPlayers}
          teamBPlayers={teamBPlayers}
          teamADraftPicks={state.teamA.draftPicks}
          teamBDraftPicks={state.teamB.draftPicks}
          teamARookieExtensions={state.teamA.rookieExtensions}
          teamBRookieExtensions={state.teamB.rookieExtensions}
          impactA={tradeImpactA}
          impactB={tradeImpactB}
          submissionStatus={submissionStatus}
          userFranchiseId={authUser?.franchiseId ?? null}
          onSubmit={handleSubmitTrade}
          onClose={() => {
            setShowConfirmationModal(false);
            setSubmissionStatus({ status: 'idle', errorMessage: null });
            // Return focus to the submit button
            submitBtnRef.current?.focus();
          }}
          onViewMyTrades={() => {
            setShowPendingPanel(true);
          }}
        />
      )}

      {authUser && (
        <PendingTradesPanel
          authUser={authUser}
          teams={data.teams}
          isOpen={showPendingPanel}
          onClose={() => setShowPendingPanel(false)}
          onLoadIntoBuilder={handleLoadTradeIntoBuilder}
          drafts={drafts}
          onLoadDraft={handleLoadDraft}
          onDeleteDraft={handleDeleteDraft}
          onRenameDraft={handleRenameDraft}
        />
      )}

      {/* Screen reader announcements */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {submissionStatus.status === 'success' && 'Trade proposal sent'}
        {submissionStatus.status === 'error' && `Trade submission failed: ${submissionStatus.errorMessage}`}
      </div>

      <style>{`
        .trade-builder {
          max-width: 1200px;
          margin: 0 auto;
          padding: 1rem;
        }
        .trade-builder__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        .trade-builder__header h1 {
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--color-gray-900, #111827);
          margin: 0;
          line-height: 1.2;
        }
        .trade-builder__actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .btn {
          padding: 0.5rem 1rem;
          border-radius: var(--radius-md, 0.5rem);
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--content-border, #e2e8f0);
          transition: all 0.15s ease;
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .btn--secondary {
          background: var(--content-bg, #fff);
          color: var(--color-gray-900, #111827);
        }
        .btn--secondary:not(:disabled):hover {
          border-color: var(--color-primary, #1c497c);
          background: var(--color-gray-50, #f9fafb);
        }
        .btn--primary {
          background: var(--btn-primary-bg, #1c497c);
          color: var(--btn-primary-text, #fff);
          border-color: var(--btn-primary-bg, #1c497c);
        }
        .btn--primary:not(:disabled):hover {
          background: var(--btn-primary-bg-hover, #164066);
          border-color: var(--btn-primary-bg-hover, #164066);
        }
        .trade-builder__panels {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 0.75rem;
          align-items: start;
        }
        .trade-builder__divider {
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 2.5rem;
        }
        .trade-builder__swap {
          background: var(--btn-primary-bg, #1c497c);
          color: #fff;
          border: none;
          border-radius: 50%;
          width: 2.5rem;
          height: 2.5rem;
          font-size: 1.25rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s ease;
        }
        .trade-builder__swap:hover {
          transform: scale(1.1);
        }
        .trade-builder__swap:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border-width: 0;
        }
        @media (max-width: 768px) {
          .trade-builder__panels {
            grid-template-columns: 1fr;
          }
          .trade-builder__divider {
            padding: 0.5rem 0;
          }
          .trade-builder__swap {
            transform: rotate(90deg);
          }
          .trade-builder__swap:hover {
            transform: rotate(90deg) scale(1.1);
          }
        }
        @media (max-width: 640px) {
          .trade-builder__header {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          .trade-builder__actions {
            width: 100%;
          }
          .trade-builder__actions .btn {
            flex: 1;
            min-width: 0;
            text-align: center;
          }
        }
      `}</style>
    </div>
  );
}
