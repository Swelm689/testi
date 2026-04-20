const { setCors, requireSupabaseUser, fetchAccountData, fetchHistoryPage, upsertProfile, replaceTextPresetStore, replaceDesignPresetState, saveHistoryItems, deleteHistoryItem, clearHistoryItems, removeStorageObjects, readJsonBody } = require('../lib/_supabase');

const HISTORY_PAGE_LIMIT = 16;

function countCustomPresetEntries(store) {
  return Object.values(store || {}).reduce((sum, entry) => {
    return sum + (Array.isArray(entry && entry.custom) ? entry.custom.length : 0);
  }, 0);
}

function normalizeDesignPresetStateForResponse(state) {
  const nextState = state && typeof state === 'object' ? state : {};
  return {
    hiddenBuiltins: Array.isArray(nextState.hiddenBuiltins) ? nextState.hiddenBuiltins : [],
    nameOverrides: nextState.nameOverrides && typeof nextState.nameOverrides === 'object' ? nextState.nameOverrides : {},
    customPresets: Array.isArray(nextState.customPresets) ? nextState.customPresets : [],
    fontCustomPresets: Array.isArray(nextState.fontCustomPresets) ? nextState.fontCustomPresets : [],
  };
}

function buildMigrationSummary(historyItems, titleStore, charStore, designPresetState) {
  const customDesignPresetCount =
    (Array.isArray(designPresetState && designPresetState.customPresets) ? designPresetState.customPresets.length : 0)
    + (Array.isArray(designPresetState && designPresetState.fontCustomPresets) ? designPresetState.fontCustomPresets.length : 0);
  return {
    historyCount: Array.isArray(historyItems) ? historyItems.length : 0,
    presetCount: countCustomPresetEntries(titleStore) + countCustomPresetEntries(charStore),
    customDesignPresetCount,
  };
}
module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ctx = await requireSupabaseUser(req, res);
  if (!ctx) return;

  try {
    if (req.method === 'GET') {
      const data = await fetchAccountData(ctx.admin, ctx.user.id, { includeHistory: false });
      return res.status(200).json({ ok: true, ...data, user: ctx.user });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = await readJsonBody(req);
    const action = body && body.action ? String(body.action) : 'bootstrap';

    if (action === 'bootstrap') {
      await upsertProfile(ctx.admin, ctx.user);
      const data = await fetchAccountData(ctx.admin, ctx.user.id, { includeHistory: true, historyLimit: HISTORY_PAGE_LIMIT });
      return res.status(200).json({ ok: true, ...data, user: ctx.user });
    }

    if (action === 'migrate') {
      await upsertProfile(ctx.admin, ctx.user);
      const existing = await ctx.admin.from('profiles').select('migrated_local_data_at').eq('id', ctx.user.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && existing.data.migrated_local_data_at) {
        const data = await fetchAccountData(ctx.admin, ctx.user.id, { includeHistory: false });
        return res.status(200).json({ ok: true, skipped: true, ...data, user: ctx.user });
      }

      const titleStore = body.titleStore || {};
      const charStore = body.charStore || {};
      const designPresetState = normalizeDesignPresetStateForResponse(body.designPresetState);
      await replaceTextPresetStore(ctx.admin, ctx.user.id, 'title', titleStore);
      await replaceTextPresetStore(ctx.admin, ctx.user.id, 'char', charStore);
      await replaceDesignPresetState(ctx.admin, ctx.user.id, designPresetState);
      const savedHistory = await saveHistoryItems(ctx.admin, ctx.user.id, Array.isArray(body.history) ? body.history : [], { fastMigration: true });
      const migratedAt = new Date().toISOString();
      const { error: updateError } = await ctx.admin.from('profiles').update({ migrated_local_data_at: migratedAt }).eq('id', ctx.user.id);
      if (updateError) throw updateError;
      const profileRes = await ctx.admin.from('profiles').select('*').eq('id', ctx.user.id).maybeSingle();
      if (profileRes.error) throw profileRes.error;
      const profile = profileRes.data ? { ...profileRes.data, migrated_local_data_at: profileRes.data.migrated_local_data_at || migratedAt } : null;
      const summary = buildMigrationSummary(savedHistory, titleStore, charStore, designPresetState);
      return res.status(200).json({
        ok: true,
        migrated: true,
        profile,
        history: savedHistory,
        titlePresetStore: titleStore,
        charPresetStore: charStore,
        designPresetState,
        summary,
        user: ctx.user,
      });
    }
    if (action === 'save-text-presets') {
      await replaceTextPresetStore(ctx.admin, ctx.user.id, 'title', body.titleStore || {});
      await replaceTextPresetStore(ctx.admin, ctx.user.id, 'char', body.charStore || {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'save-design-presets') {
      await replaceDesignPresetState(ctx.admin, ctx.user.id, body.designPresetState || {});
      const data = await fetchAccountData(ctx.admin, ctx.user.id, { includeHistory: false });
      return res.status(200).json({ ok: true, designPresetState: data.designPresetState, summary: data.summary });
    }

    if (action === 'load-history-page') {
      const offset = Number.isFinite(Number(body.offset)) ? Math.max(0, Number(body.offset)) : 0;
      const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(HISTORY_PAGE_LIMIT, Number(body.limit))) : HISTORY_PAGE_LIMIT;
      const page = await fetchHistoryPage(ctx.admin, ctx.user.id, { offset, limit, includeCount: false });
      return res.status(200).json({ ok: true, ...page });
    }
    if (action === 'save-history') {
      const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : []);
      const saved = await saveHistoryItems(ctx.admin, ctx.user.id, items);
      return res.status(200).json({ ok: true, items: saved });
    }

    if (action === 'delete-history') {
      if (!body.id) return res.status(400).json({ error: 'id is required' });
      await deleteHistoryItem(ctx.admin, ctx.user.id, body.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'clear-history') {
      const deletedCount = await clearHistoryItems(ctx.admin, ctx.user.id);
      return res.status(200).json({ ok: true, deletedCount });
    }

    if (action === 'delete-owned-assets') {
      await removeStorageObjects(ctx.admin, Array.isArray(body.assets) ? body.assets : []);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown account action' });
  } catch (error) {
    console.error('account handler error', error);
    return res.status(500).json({ error: error && error.message ? error.message : 'Account request failed' });
  }
};





