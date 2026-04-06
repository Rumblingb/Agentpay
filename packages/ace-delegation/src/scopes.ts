/**
 * AllowedAction — the set of actions an operator can be granted.
 *
 * plan         → read-only: can request a plan, cannot book
 * book_rail    → can book rail tickets within policy limits
 * book_flight  → can book flights within policy limits
 * book_hotel   → can book hotels within policy limits
 * cancel       → can cancel an existing booking
 * reroute      → can request a reroute during a live journey
 */
export type AllowedAction =
  | 'plan'
  | 'book_rail'
  | 'book_flight'
  | 'book_hotel'
  | 'cancel'
  | 'reroute'

export const ALL_ACTIONS: readonly AllowedAction[] = [
  'plan',
  'book_rail',
  'book_flight',
  'book_hotel',
  'cancel',
  'reroute',
] as const

/**
 * isValidAction — type guard for AllowedAction strings.
 */
export function isValidAction(action: string): action is AllowedAction {
  return (ALL_ACTIONS as readonly string[]).includes(action)
}

/**
 * validateActions — filters a raw string array to known AllowedAction values.
 * Unknown strings are silently dropped.
 */
export function validateActions(raw: string[]): AllowedAction[] {
  return raw.filter(isValidAction)
}
