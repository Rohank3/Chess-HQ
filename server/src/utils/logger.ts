import { env } from '../config/env.js';

export type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
} as const;

type Level = keyof typeof LEVEL_PRIORITY;

const minPriority = LEVEL_PRIORITY[env.LOG_LEVEL];

function write(level: Level, message: string, fields?: LogFields): void {
  if (LEVEL_PRIORITY[level] < minPriority) return;
  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields,
  };
  const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(record) + '\n');
}

export const logger = {
  fatal: (msg: string, fields?: LogFields) => write('fatal', msg, fields),
  error: (msg: string, fields?: LogFields) => write('error', msg, fields),
  warn: (msg: string, fields?: LogFields) => write('warn', msg, fields),
  info: (msg: string, fields?: LogFields) => write('info', msg, fields),
  debug: (msg: string, fields?: LogFields) => write('debug', msg, fields),
  trace: (msg: string, fields?: LogFields) => write('trace', msg, fields),
};
