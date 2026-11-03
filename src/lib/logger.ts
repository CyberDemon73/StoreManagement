import pino from 'pino';
import { getEnv } from './env';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  // Never let credentials or session material reach the log sink.
  redact: {
    paths: ['password', 'token', 'cookie', '*.password', '*.token', '*.cookie', 'headers.cookie'],
    censor: '[redacted]',
  },
  base: undefined,
});
