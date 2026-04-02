/**
 * Settings Repository
 *
 * Manages global application settings (single row, id='global')
 */

import type { DatabaseLike } from '../connection'
import type { Settings, SettingsUpdate } from '../types'

const SETTINGS_ID = 'global'

/**
 * Get global settings
 *
 * @returns Current settings (always exists after migrations)
 */
export function getSettings(db: DatabaseLike): Settings {
  const settings = db.prepare('SELECT * FROM settings WHERE id = ?').get(SETTINGS_ID) as
    | Settings
    | undefined

  if (!settings) {
    throw new Error('Settings not found. Run migrations first.')
  }

  return settings
}

/**
 * Update global settings
 *
 * @param update - Partial settings to update
 * @returns Updated settings
 */
export function updateSettings(
  db: DatabaseLike,
  update: SettingsUpdate
): Settings {
  const current = getSettings(db)
  const now = Date.now()

  const newSettings = {
    llm_base_url: update.llm_base_url ?? current.llm_base_url,
    llm_api_key: update.llm_api_key ?? current.llm_api_key,
    llm_model: update.llm_model ?? current.llm_model,
    max_turns: update.max_turns ?? current.max_turns,
    max_budget_usd: update.max_budget_usd ?? current.max_budget_usd,
    updated_at: now,
  }

  db.prepare(
    `
    UPDATE settings
    SET llm_base_url = ?,
        llm_api_key = ?,
        llm_model = ?,
        max_turns = ?,
        max_budget_usd = ?,
        updated_at = ?
    WHERE id = ?
  `
  ).run(
    newSettings.llm_base_url,
    newSettings.llm_api_key,
    newSettings.llm_model,
    newSettings.max_turns,
    newSettings.max_budget_usd,
    newSettings.updated_at,
    SETTINGS_ID
  )

  return getSettings(db)
}

/**
 * Reset settings to defaults
 *
 * @returns Reset settings
 */
export function resetSettings(db: DatabaseLike): Settings {
  const now = Date.now()

  db.prepare(
    `
    UPDATE settings
    SET llm_base_url = 'http://localhost:7024/v1',
        llm_api_key = '',
        llm_model = 'claude-sonnet-4-6',
        max_turns = 50,
        max_budget_usd = 10.0,
        updated_at = ?
    WHERE id = ?
  `
  ).run(now, SETTINGS_ID)

  return getSettings(db)
}
