/**
 * Optional shared secret for public tunnels.
 * Env: FRESHLENS_API_KEY or API_KEY
 * If unset, all routes stay open (home LAN).
 */
export function resolveApiKey() {
  const key =
    process.env.FRESHLENS_API_KEY?.trim() ||
    process.env.API_KEY?.trim() ||
    '';
  return key || null;
}

export function requireApiKey(req, res, next) {
  const expected = resolveApiKey();
  if (!expected) return next();

  const header = req.get('x-freshlens-key') || req.get('authorization') || '';
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const provided = (bearer || header).trim();

  if (provided && provided === expected) return next();

  return res.status(401).json({
    error: 'Unauthorized',
    hint: 'Set header X-FreshLens-Key (or Authorization: Bearer …) to match FRESHLENS_API_KEY on the server.',
  });
}
