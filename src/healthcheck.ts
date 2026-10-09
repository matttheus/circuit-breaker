const port = process.env.PORT ?? '3000';

try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
