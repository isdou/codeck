let prompt = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => {
  process.stdout.write('SLOW_PARTIAL\n');

  setTimeout(() => {
    const token = prompt.match(/\bsk-[A-Za-z0-9_-]{16,}/)?.[0] || '';
    process.stdout.write(`SLOW_DONE ${token}\n`);
  }, 500);
});
