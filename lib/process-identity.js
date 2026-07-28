const fs = require('fs');

/**
 * Return the exact identity of a live Linux process. PIDs can be reused;
 * /proc field 22 is the process start time in clock ticks since boot and is
 * stable for the lifetime of one process.
 */
function processIdentity(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${numericPid}/stat`, 'utf8');
    // Fields after the executable name start at proc field 3 (state), so
    // index 19 is field 22: process starttime in clock ticks since boot.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (!fields[19] || fields[0] === 'Z') return null;
    return { pid: numericPid, startTime: fields[19] };
  } catch {
    return null;
  }
}

function processIdentityAlive(identity) {
  const current = processIdentity(identity?.pid);
  return !!current && current.startTime === String(identity.startTime);
}

module.exports = { processIdentity, processIdentityAlive };
