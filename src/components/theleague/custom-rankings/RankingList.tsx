/**
 * RankingList — drag-and-drop sortable player ranking list.
 *
 * Uses @dnd-kit for drag-and-drop, following the same patterns as
 * ManageImportsSection.tsx. Interleaves tier dividers between players.
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import React from 'react';
import PlayerRow from './PlayerRow';
import TierDivider from './TierDivider';
import type { RankedPlayer, TierBreak } from '../../../types/custom-rankings';

interface RankingListProps {
  players: RankedPlayer[];
  tiers: TierBreak[];
  isEditing: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onRemoveTier: (afterPlayerId: string) => void;
  onRenameTier: (afterPlayerId: string, newLabel: string) => void;
}

export default function RankingList({
  players,
  tiers,
  isEditing,
  onReorder,
  onRemoveTier,
  onRenameTier,
}: RankingListProps) {
  const editSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const noSensors = useSensors();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = players.findIndex((p) => p.id === active.id);
    const newIndex = players.findIndex((p) => p.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(oldIndex, newIndex);
    }
  };

  // Build a set of playerIds that have tier breaks after them
  const tierMap = new Map<string, TierBreak>();
  for (const tier of tiers) {
    tierMap.set(tier.afterPlayerId, tier);
  }

  // Compute tier numbers sequentially
  let tierCounter = 1;
  const tierNumbers = new Map<string, number>();
  // First tier is implicit (Tier 1 at the top)
  for (const player of players) {
    const tier = tierMap.get(player.id);
    if (tier) {
      tierCounter++;
      tierNumbers.set(player.id, tierCounter);
    }
  }

  return (
    <DndContext
      sensors={isEditing ? editSensors : noSensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={players.map((p) => p.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="cr-list">
          {players.map((player, index) => {
            const tier = tierMap.get(player.id);
            return (
              <React.Fragment key={player.id}>
                <PlayerRow player={player} rank={index + 1} isEditing={isEditing} />
                {tier && (
                  <TierDivider
                    tier={tier}
                    tierNumber={tierNumbers.get(player.id) ?? tierCounter}
                    onRemove={onRemoveTier}
                    onRename={onRenameTier}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
