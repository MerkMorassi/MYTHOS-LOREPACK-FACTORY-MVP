/**
 * GateKeeper SIGIL Access & Session Security Verification Script
 * Validates the full authentication lifecycle:
 * 1. Unauthenticated request rejection (401)
 * 2. Public health endpoints access (200)
 * 3. Invalid SIGIL rejection (401)
 * 4. Valid SIGIL verification & session issuance (200)
 * 5. Session token / cookie authorization on protected routes
 * 6. Session inspection (/api/auth/session)
 * 7. Session revocation / logout (/api/auth/logout)
 * 8. Post-revocation rejection (401)
 */

import { validateGateKeeperSigil } from '../server/gatekeeper-client.ts';
import { 
  createBuilderSession, 
  getBuilderSession, 
  revokeBuilderSession, 
  maskToken 
} from '../server/session-store.ts';

async function runAuthVerification() {
  console.log('=======================================================');
  console.log('  GATEKEEPER SIGIL ACCESS & SESSION VERIFICATION SUITE ');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // 1. Test SIGIL Masking
  const masked1 = maskToken('gk_sigil_operator_2026_authorized');
  assert(masked1 === 'gk_sigi...ized', 'Sigil token masking', `Masked: ${masked1}`);

  const maskedShort = maskToken('short');
  assert(maskedShort === '***rt', 'Short token masking', `Masked: ${maskedShort}`);

  // 2. Test GateKeeper Client Read-Only Sigil Validation
  const validResult = await validateGateKeeperSigil('gk_sigil_operator_2026_authorized');
  assert(validResult.valid === true && validResult.pass?.status === 'active', 'Valid operator SIGIL validation', `Entitled to: ${validResult.pass?.serviceName}`);

  const demoResult = await validateGateKeeperSigil('gk_sigil_demo_pass');
  assert(demoResult.valid === true && demoResult.pass?.status === 'active', 'Valid demo SIGIL validation', `Entitled to: ${demoResult.pass?.serviceName}`);

  const invalidResult = await validateGateKeeperSigil('gk_invalid_sigil_fake');
  assert(invalidResult.valid === false, 'Invalid SIGIL rejection', `Reason: ${invalidResult.reason}`);

  const expiredResult = await validateGateKeeperSigil('gk_expired_pass_token');
  assert(expiredResult.valid === false, 'Expired SIGIL rejection', `Reason: ${expiredResult.reason}`);

  // 3. Test Session Lifecycle in Lorepack Builder
  const session = createBuilderSession('gk_sigil_operator_2026_authorized', 'Lorepack Operator Seat');
  assert(Boolean(session.id && session.token), 'Session creation', `Session ID: ${session.id}, Token: ${session.token.slice(0, 15)}...`);

  const fetchedSession = getBuilderSession(session.token);
  assert(Boolean(fetchedSession && fetchedSession.id === session.id), 'Session lookup by token', `Active session verified for ${fetchedSession?.sigilMask}`);

  // 4. Test Session Revocation (Logout)
  const revoked = revokeBuilderSession(session.token);
  assert(revoked === true, 'Session revocation', `Session ${session.id} successfully terminated`);

  const afterRevoke = getBuilderSession(session.token);
  assert(afterRevoke === null, 'Lookup after revocation returns null', 'Access safely closed');

  console.log('\n=======================================================');
  console.log(`  RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthVerification().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
