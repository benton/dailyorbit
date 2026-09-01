import pino, { type Logger, type DestinationStream } from 'pino';

export type AppLogger = Logger;

export type LoggerOptions = {
  env?: string;
  destination?: DestinationStream;
  level?: pino.LevelWithSilent;
};

export function createLogger(options: LoggerOptions = {}): AppLogger {
  const env: string = options.env ?? process.env.NODE_ENV ?? 'development';
  const isProduction: boolean = env === 'production';

  const transport: pino.TransportSingleOptions | undefined =
    !isProduction && !options.destination
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined;

  return pino(
    {
      level: options.level ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(transport ? { transport } : {}),
    },
    options.destination,
  );
}

/** Singleton logger for the application. */
let _logger: AppLogger | undefined;

export function getLogger(): AppLogger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

export function setLogger(logger: AppLogger): void {
  _logger = logger;
}
