// Surface useful test output in public check annotations as well as job logs.
// GitHub's raw log download requires authentication even for public repositories.
const fs = require('node:fs');
const file = process.argv[2];
if (file && fs.existsSync(file)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const starts = lines.flatMap((line, index) =>
    /[✘✖]|not ok|Error:|Test timeout/.test(line) ? [index] : []);
  starts.push(Math.max(0, lines.length - 100));
  let end = 0;
  for (const start of starts) {
    if (start < end) continue;
    end = Math.min(lines.length, start + 100);
    const excerpt = lines.slice(start, end).join('\n').slice(0, 12000);
    const escaped = excerpt.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error::${escaped}`);
  }
}
