/**
 * React twins of EmptyState.astro / ErrorState.astro, for client-hydrated
 * islands. Same class list, role and icon (src/utils/state-html.ts), same
 * global stylesheet — so a state rendered in an island matches one the server
 * rendered. Copy rules: docs/claude/rules/theming-and-assets.md
 * § "Empty and error states".
 */
import type { ReactNode } from 'react';
import '../../../styles/states.css';
import { STATE_ICONS, stateClassName, stateRole, type StateAction, type StateKind } from '../../../utils/state-html';

export interface UiStateProps {
  title: string;
  body?: ReactNode;
  actions?: Array<StateAction & { onClick?: () => void }>;
  compact?: boolean;
  className?: string;
}

function UiState({ kind, title, body, actions = [], compact = false, className }: UiStateProps & { kind: StateKind }) {
  return (
    <div className={stateClassName(kind, { compact, class: className })} role={stateRole(kind)}>
      {!compact && <span className="ui-state__icon" dangerouslySetInnerHTML={{ __html: STATE_ICONS[kind] }} />}
      <p className="ui-state__title">{title}</p>
      {body && <p className="ui-state__body">{body}</p>}
      {actions.length > 0 && (
        <div className="ui-state__actions">
          {actions.map((a) =>
            a.href ? (
              <a key={a.label} className="ui-state__action" href={a.href}>
                {a.label}
              </a>
            ) : (
              <button key={a.label} type="button" className="ui-state__action" data-state-action={a.id} onClick={a.onClick}>
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyState(props: UiStateProps) {
  return <UiState kind="empty" {...props} />;
}

export function ErrorState(props: UiStateProps) {
  return <UiState kind="error" {...props} />;
}
