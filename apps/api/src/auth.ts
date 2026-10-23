import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';

/** Returns the Supabase user id of a valid access token, or throws. */
export type VerifyToken = (token: string) => Promise<string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Supabase Auth access tokens against the project's public signing keys (asymmetric,
 * ES256). Shared-secret (HS256) tokens are refused: the API never holds the JWT secret.
 */
export function supabaseVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey): VerifyToken {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
      requiredClaims: ['sub', 'exp'],
    });
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw new Error('not a signed-in user token');
    }
    return payload.sub;
  };
}
