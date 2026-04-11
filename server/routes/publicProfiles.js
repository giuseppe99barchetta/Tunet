// Public Dashboard Mode — unauthenticated profile access.
// Exposes a single read-only endpoint that returns the designated default
// profile for kiosk/wall-tablet devices.  Only active when
// TUNET_PUBLIC_MODE_ENABLED=true is set.
//
// Relevant env vars:
//   TUNET_PUBLIC_MODE_ENABLED=true    — must be set to enable all public routes
//   TUNET_PUBLIC_DEFAULT_PROFILE_ID   — specific profile UUID to serve (takes priority)
//   TUNET_PUBLIC_HA_USER_ID           — HA user ID; returns that user's newest profile
//
// If neither is configured, 404 is returned so the client falls back to
// its locally-stored layout.

import { Router } from 'express';
import db from '../db.js';
import { resolveStoredDataText } from '../utils/dataCrypto.js';

const router = Router();

const safeParseJson = (raw, fallback = null) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const parseStoredProfileData = (row, context) => {
  const resolvedText = resolveStoredDataText({
    plainText: row?.data,
    encryptedText: row?.data_enc,
    context,
  });
  return safeParseJson(resolvedText, {});
};

// GET /api/public-profiles/default
router.get('/default', (_req, res) => {
  if (process.env.TUNET_PUBLIC_MODE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  const specificId = (process.env.TUNET_PUBLIC_DEFAULT_PROFILE_ID || '').trim();
  const publicUserId = (process.env.TUNET_PUBLIC_HA_USER_ID || '').trim();

  let profile = null;

  if (specificId) {
    profile = db
      .prepare(
        'SELECT id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at FROM profiles WHERE id = ?'
      )
      .get(specificId);
  } else if (publicUserId) {
    profile = db
      .prepare(
        'SELECT id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at FROM profiles WHERE ha_user_id = ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(publicUserId);
  }

  if (!profile) {
    return res.status(404).json({ error: 'No public default profile configured' });
  }

  return res.json({
    id: profile.id,
    ha_user_id: profile.ha_user_id,
    name: profile.name,
    device_label: profile.device_label,
    data: parseStoredProfileData(profile, `public-profiles/default:${profile.id}`),
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  });
});

export default router;
