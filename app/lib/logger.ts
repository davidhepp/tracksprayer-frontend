export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
};

export type Logger = {
  entries: LogEntry[];
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

export function createLogEntry(
  level: LogLevel,
  message: string,
  id = Date.now(),
): LogEntry {
  return {
    id,
    timestamp: new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    level,
    message,
  };
}

export function writeConsoleLog(
  scope: string,
  level: LogLevel,
  message: string,
  details?: unknown,
) {
  const payload = details === undefined ? "" : details;
  const line = `[${scope}] ${message}`;

  if (level === "error") {
    console.error(line, payload);
    return;
  }

  if (level === "warn") {
    console.warn(line, payload);
    return;
  }

  console.info(line, payload);
}
