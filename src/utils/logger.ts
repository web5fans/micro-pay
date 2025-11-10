function formatTimestamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${ms}`;
}

export function initLogger(): void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const withPrefix = (level: string, fn: (...args: any[]) => void) => {
    return (...args: any[]) => {
      const ts = formatTimestamp();
      fn(`[${ts}] [${level}]`, ...args);
    };
  };

  console.log = withPrefix('LOG', original.log);
  console.info = withPrefix('INFO', original.info);
  console.warn = withPrefix('WARN', original.warn);
  console.error = withPrefix('ERROR', original.error);
  console.debug = withPrefix('DEBUG', original.debug);
}