/**
 * SAM — WebAuthn configuration.
 *
 * RP ID is the full MagicDNS hostname from Phase 1. Changing this
 * invalidates every registered passkey — do not rename the machine.
 */

export const RP_ID = 'super-awesome-machine.tail2eadff.ts.net';
export const RP_NAME = 'SAM';
export const ORIGIN = `https://${RP_ID}`;
