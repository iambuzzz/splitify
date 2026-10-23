export type MemberId = string;

export type Role = 'owner' | 'admin' | 'member';

export interface Actor {
  memberId: MemberId;
  /** Group role. Note: the group "owner" role is unrelated to owning an expense. */
  role: Role;
}

export type WorkflowErrorCode =
  | 'forbidden'
  | 'invalid_state'
  | 'stale_version'
  | 'reason_required'
  | 'not_eligible';

export type Result<S, E> =
  | { ok: true; state: S; effects: E[]; duplicate?: true }
  | { ok: false; error: WorkflowErrorCode };

export function fail(error: WorkflowErrorCode): { ok: false; error: WorkflowErrorCode } {
  return { ok: false, error };
}
