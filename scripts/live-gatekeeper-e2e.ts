/**
 * LIVE LOREPACK FACTORY — GATEKEEPER END-TO-END TEST
 * This script simulates a customer journey:
 * 1. Presenting SIGIL to LOREPACK SERVER
 * 2. Server verifying with (Mocked) GateKeeper Authority
 * 3. Establishing session cookie
 * 4. Accessing protected resources
 * 5. Session termination
 */

const BASE_URL = process.env.TEST_URL || 'https://mythos-lorepack-factory-mvp.vercel.app';

async function runLiveTest() {
  console.log('--- LOREPACK FACTORY: LIVE GATEKEEPER E2E TEST ---');

  // 1. Check Public Health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  console.log(`[1] Public Health Check: ${healthRes.status} ${healthRes.statusText}`);
  if (!healthRes.ok) throw new Error('Health check failed');

  // 2. Attempt Unauthenticated Access
  const unauthRes = await fetch(`${BASE_URL}/api/lorepack/models`);
  console.log(`[2] Unauthenticated Access Attempt: ${unauthRes.status} (Expected 401)`);
  if (unauthRes.status !== 401) throw new Error('Unauthenticated access not blocked');

  // 3. Present Valid SIGIL
  const validSigil = 'gk_sigil_operator_2026_authorized';
  console.log(`[3] Presenting Valid SIGIL: ${validSigil.slice(0, 7)}...`);
  
  const loginRes = await fetch(`${BASE_URL}/api/auth/sigil-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sigil: validSigil })
  });

  const loginData: any = await loginRes.json();
  console.log(`[4] Verification Result: ${loginRes.status} ${loginData.success ? 'GRANTED' : 'DENIED'}`);
  
  if (!loginData.success || !loginData.session) throw new Error('Login failed for valid SIGIL');
  
  // Extract session cookie from headers
  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie received');
  console.log(`[5] Session Cookie Received: ${setCookie.split(';')[0]}... (HTTP-only)`);

  // 4. Access Protected Resource with Session
  const protectedRes = await fetch(`${BASE_URL}/api/lorepack/models`, {
    headers: { 'Cookie': setCookie.split(';')[0] }
  });
  
  console.log(`[6] Protected Resource Access (with Cookie): ${protectedRes.status} ${protectedRes.statusText}`);
  if (!protectedRes.ok) throw new Error('Protected access failed with valid session');
  
  const modelsData: any = await protectedRes.json();
  console.log(`[7] Models Retrieved: ${modelsData.models.length} models available`);

  // 5. Test Invalid SIGIL
  const invalidSigil = 'gk_invalid_sigil_fake';
  const invalidRes = await fetch(`${BASE_URL}/api/auth/sigil-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sigil: invalidSigil })
  });
  console.log(`[8] Invalid SIGIL Attempt: ${invalidRes.status} (Expected 401)`);
  if (invalidRes.status !== 401) throw new Error('Invalid SIGIL not rejected');

  // 6. Logout / Revoke Session
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Cookie': setCookie.split(';')[0] }
  });
  console.log(`[9] Logout Request: ${logoutRes.status} ${logoutRes.statusText}`);
  
  // 7. Verify Post-Logout Rejection
  const postLogoutRes = await fetch(`${BASE_URL}/api/lorepack/models`, {
    headers: { 'Cookie': setCookie.split(';')[0] }
  });
  console.log(`[10] Post-Logout Access Attempt: ${postLogoutRes.status} (Expected 401)`);
  if (postLogoutRes.status !== 401) throw new Error('Access not revoked after logout');

  console.log('\n--- ALL LIVE E2E TEST PHASES PASSED ---');
}

runLiveTest().catch(err => {
  console.error('\n!!! E2E TEST FAILED !!!');
  console.error(err);
  process.exit(1);
});
