export interface RuleProposal {
  id: string;
  title: string;
  /** Season the change would take effect, e.g. "2027 season". */
  season: string;
  summary: string;
  /** One line per change, plain text. */
  changes: string[];
  /** The rulebook sections this would replace. */
  replaces: string;
  href: string;
  linkLabel: string;
}
