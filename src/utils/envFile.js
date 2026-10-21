/**
 * One line of a .env file. Zero imports (used by the installer and by tests).
 * Refuses anything that could add a second line — a pasted line break would otherwise inject extra variables into the file —
 * and quotes values that dotenv would otherwise cut (spaces, `#`, quotes, `$`, backslashes).
 */
export function envLine(key, value) {
  const v = String(value ?? '');
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`bad variable name ${key}`);
  if (/[\r\n\0]/.test(v)) throw new Error(`${key} contains a line break`);
  if (!/[\s#'"`$\\]/.test(v)) return `${key}=${v}`;
  if (!v.includes("'")) return `${key}='${v}'`;
  if (!v.includes('"')) return `${key}="${v}"`;
  throw new Error(`${key} contains both quote kinds and cannot be written safely`);
}
