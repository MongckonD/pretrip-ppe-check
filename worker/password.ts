/**
 * Password hashing with PBKDF2-SHA256 (WebCrypto, built into Workers).
 * Stored as: pbkdf2-sha256$<iterations>$<salt base64url>$<hash base64url>
 * Workers cap PBKDF2 at 100,000 iterations; the count is stored per hash so it can change later.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const expected = fromB64url(parts[3]);
  const actual = await derive(password, fromB64url(parts[2]), iterations);
  return timingSafeEqual(actual, expected);
}

/** Same work as a real check, so "unknown user" and "wrong password" take the same time. */
const DUMMY_HASH = `pbkdf2-sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/**
 * A FIRST password set by an admin (new account, import, reset): may be short and simple (e.g. 123456) so it is
 * easy to hand out. A simple one (fails passwordProblem) must be changed at the first sign-in — see mustChangeFirst;
 * one that already meets the full rules is used as it is.
 */
export function firstPasswordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || !password) return 'กรุณากรอกรหัสผ่าน';
  if (password.length < 6) return 'รหัสผ่านเริ่มต้นต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (password.length > 128) return 'รหัสผ่านยาวเกิน 128 ตัวอักษร';
  if (password.trim() !== password) return 'รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง';
  return null;
}

/** the password every new account starts with (add user / import / reset with the box left empty); changed at first sign-in */
export const DEFAULT_PASSWORD = '123456';

/** the most common passwords: refused for passwords people choose (an admin may still hand one out as a first password) */
const EASY = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', '654321', '123123', '112233', '121212', '123321', '102030',
  '111222', '000111', '147258', '159753', '987654', 'abc123', 'qwerty', 'qwertyui', 'password', 'passwd', 'iloveyou', 'abcdef',
]);

/** 1 = the admin-set password is simple (does not meet the full rules): the account must change it at first sign-in */
export const mustChangeFirst = (password: string, userId: string): 0 | 1 =>
  // a first password that is the employee code is as simple as 123456: changed at first sign-in too
  (passwordProblem(password, userId) || password.toLowerCase().includes(userId.toLowerCase()) ? 1 : 0);

/** Thai-language password rules (passwords people choose themselves). Returns an error message, or null when acceptable. */
export function passwordProblem(password: unknown, _userId: string): string | null {
  if (typeof password !== 'string') return 'กรุณากรอกรหัสผ่าน';
  // 6 characters (2026-11-25: easier to remember for the staff); the most common easy ones are still refused,
  // so an admin-set 123456 keeps forcing a change at first sign-in
  if (password.length < 6) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (password.length > 128) return 'รหัสผ่านยาวเกิน 128 ตัวอักษร';
  if (password.trim() !== password) return 'รหัสผ่านต้องไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง';
  // 2026-11-25: the owner chose to allow the employee code as a password (easier for the staff to remember)
  if (/^(.)\1+$/.test(password) || EASY.has(password.toLowerCase())) return 'รหัสผ่านนี้เดาง่ายเกินไป';
  return null;
}

/** SHA-256 hex, used to store session tokens. */
export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
