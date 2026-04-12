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
// If neither is configured, the newest available profile is returned.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db.js';
import {
  encryptDataText,
  getEncryptedOnlyPlaintextStub,
  isEncryptionWriteRequired,
  resolveStoredDataText,
  shouldPersistPlaintextData,
} from '../utils/dataCrypto.js';

const router = Router();

// Mirrors the envFlag helper in server/index.js — normalises boolean-like env strings.
const envFlag = (value) => String(value || '').trim().toLowerCase() === 'true';

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

const buildFallbackDashboardData = () => ({
  version: 1,
  layout: {
    pagesConfig: { header: [], pages: ['home'], home: [] },
    cardSettings: {},
    hiddenCards: [],
    customNames: {},
    customIcons: {},
    pageSettings: {},
    gridColumns: 4,
    gridGapH: 20,
    gridGapV: 20,
    cardBorderRadius: 16,
    headerSettings: { showTitle: true, showClock: true, showDate: true },
    headerTitle: '',
    headerScale: 1,
    sectionSpacing: { headerToStatus: 16, statusToNav: 24, navToGrid: 24 },
    statusPillsConfig: [],
  },
  appearance: {
    theme: 'dark',
    language: 'en',
    appFont: 'sans',
    unitsMode: 'follow_ha',
    bgMode: 'theme',
    bgColor: '#0f172a',
    bgGradient: 'midnight',
    bgImage: '',
    cardTransparency: 40,
    cardBorderOpacity: 5,
    inactivityTimeout: 60,
  },
});

// GET /api/public-profiles/default
router.get('/default', (_req, res) => {
  console.log('[PublicMode] Public profile request received.');

  if (!envFlag(process.env.TUNET_PUBLIC_MODE_ENABLED)) {
    console.log('[PublicMode] Public mode is not enabled — returning 404.');
    return res.status(404).json({ error: 'Not found' });
  }

  // Diagnostic: log how many profiles exist in the DB before querying.
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM profiles').get();
  console.log(`[PublicMode] profiles table has ${total} row(s).`);

  const specificId = (process.env.TUNET_PUBLIC_DEFAULT_PROFILE_ID || '').trim();
  const publicUserId = (process.env.TUNET_PUBLIC_HA_USER_ID || '').trim();

  let profile = null;

  if (specificId) {
    console.log(`[PublicMode] Looking up specific profile id: ${specificId}`);
    profile = db
      .prepare(
        'SELECT id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at FROM profiles WHERE id = ?'
      )
      .get(specificId);
  } else if (publicUserId) {
    console.log(`[PublicMode] Looking up latest profile for ha_user_id: ${publicUserId}`);
    profile = db
      .prepare(
        'SELECT id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at FROM profiles WHERE ha_user_id = ? ORDER BY updated_at DESC LIMIT 1'
      )
      .get(publicUserId);
  } else {
    // Fallback: return the most recently updated profile regardless of owner.
    // No ha_user_id filter — profiles created by any logged-in user are eligible.
    console.log('[PublicMode] No specific id/user configured — falling back to latest profile in DB.');
    profile = db
      .prepare(
        'SELECT id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at FROM profiles ORDER BY updated_at DESC LIMIT 1'
      )
      .get();
    if (profile) {
      console.log(`[PublicMode] Falling back to the latest available profile: ${profile.name || profile.id}`);
    }
  }

  if (!profile) {
    console.log('[PublicMode] Database query result: not found — returning fallback empty structure.');
    return res.json({
      id: 'public-default-fallback',
      ha_user_id: null,
      name: 'Public Default',
      device_label: null,
      data: buildFallbackDashboardData(),
      created_at: null,
      updated_at: null,
    });
  }

  console.log(`[PublicMode] Database query result: found profile "${profile.name || profile.id}" (${profile.id}).`);
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

// PUT /api/public-profiles/default
// Upserts the public kiosk dashboard. When no profile exists yet (empty DB or
// id='public-default-fallback'), a new row is created with ha_user_id='__public__'.
// Protected by env flags only — no HA auth required.
router.put('/default', (req, res) => {
  if (!envFlag(process.env.TUNET_PUBLIC_MODE_ENABLED)) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (envFlag(process.env.TUNET_PUBLIC_READ_ONLY)) {
    return res.status(403).json({ error: 'Public dashboard is read-only' });
  }

  const { id, data } = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'data (object) is required' });
  }

  // Count cards for debug logging
  const cardCount = Object.keys(data?.layout?.cardSettings ?? {}).length;
  console.log(`[PublicMode] Saving dashboard to database. Card count: ${cardCount}`);

  const now = new Date().toISOString();
  const payload = JSON.stringify(data);
  const encryptedPayload = encryptDataText(payload);
  if (encryptedPayload === null && isEncryptionWriteRequired()) {
    return res.status(503).json({ error: 'Encryption is required but unavailable' });
  }
  const plainPayload = shouldPersistPlaintextData() ? payload : getEncryptedOnlyPlaintextStub();

  // Use the provided id if it's a real DB row; otherwise treat it as a create request.
  const isFallbackId = !id || id === 'public-default-fallback';
  const existing = isFallbackId ? null : db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);

  if (existing) {
    db.prepare(
      'UPDATE profiles SET data = ?, data_enc = ?, updated_at = ? WHERE id = ?'
    ).run(plainPayload, encryptedPayload, now, id);
    console.log(`[PublicMode] Write-back: updated existing profile "${id}" at ${now}.`);
    return res.json({ id, updated_at: now });
  }

  // Create a new public profile row.
  const newId = randomUUID();
  db.prepare(
    'INSERT INTO profiles (id, ha_user_id, name, device_label, data, data_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(newId, '__public__', 'Public Dashboard', null, plainPayload, encryptedPayload, now, now);
  console.log(`[PublicMode] Write-back: created new public profile "${newId}" at ${now}.`);
  return res.status(201).json({ id: newId, updated_at: now });
});

export default router;
