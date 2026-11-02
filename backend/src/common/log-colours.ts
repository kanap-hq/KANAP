/**
 * Whether Nest's console logger should colour its lines.
 *
 * Nest colours whenever `NO_COLOR` is absent (`isColorAllowed` in
 * `@nestjs/common`). A pipe, a file and `docker compose logs` have no
 * terminal, so those copies stay plain text. An interactive terminal keeps
 * the colours. A non-empty `NO_COLOR` turns them off (https://no-color.org/:
 * an empty value leaves them on), which is the same check Nest already makes.
 */
export function shouldColourLogs(isTTY: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
  return isTTY === true && !env.NO_COLOR;
}
