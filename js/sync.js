// Accounts, sync and the leaderboard (Supabase). Until js/config.js has keys,
// everything runs locally and these functions do nothing.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let progress = null;

export const enabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const signedIn = () => false;
export const myUserId = () => null;
export const myRank = () => null;

export async function init(p) { progress = p; }
export function pushSoon() {}
export async function leaderboard() { return null; }

export async function authPanel() {
  return `<h2>Account</h2><p>Accounts aren't switched on yet. Your progress is saved in this browser.</p>`;
}
export function wireAuthPanel() {}

export async function exportAll(state) {
  return { exported: new Date().toISOString(), local: state };
}
export async function deleteAccount() {}
