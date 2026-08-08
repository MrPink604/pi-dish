const fs = require('fs');

function processRecord(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${numericPid}/stat`, 'utf8');
    // Fields after the executable name start at proc field 3 (state). Reading
    // PPID and starttime from the same snapshot avoids proving ancestry across
    // a PID-reuse race.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (!fields[1] || !fields[19] || fields[0] === 'Z') return null;
    return {
      pid: numericPid,
      ppid: Number(fields[1]),
      startTime: fields[19],
    };
  } catch {
    return null;
  }
}

/**
 * Return the exact identity of a live Linux process. PIDs can be reused;
 * /proc field 22 is the process start time in clock ticks since boot and is
 * stable for the lifetime of one process.
 */
function processIdentity(pid) {
  const record = processRecord(pid);
  return record ? { pid: record.pid, startTime: record.startTime } : null;
}

function processIdentityAlive(identity) {
  const current = processIdentity(identity?.pid);
  return !!current && current.startTime === String(identity.startTime);
}

/**
 * Inspect an exact process's complete Linux parent chain. `complete` is true
 * only after reaching the process-tree root; callers making destructive
 * ownership decisions must fail closed for an incomplete chain.
 */
function inspectProcessAncestry(identity, { maxDepth = 128 } = {}) {
  const expectedPid = Number(identity?.pid);
  const expectedStartTime = String(identity?.startTime ?? '');
  if (!Number.isInteger(expectedPid) || expectedPid <= 0 || !expectedStartTime) {
    return { complete: false, processes: [] };
  }

  const processes = [];
  const seen = new Set();
  let pid = expectedPid;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (seen.has(pid)) return { complete: false, processes };
    seen.add(pid);
    const record = processRecord(pid);
    if (!record) return { complete: false, processes };
    if (depth === 0 && record.startTime !== expectedStartTime) {
      return { complete: false, processes: [] };
    }
    processes.push({ pid: record.pid, startTime: record.startTime });
    if (record.ppid === 0) return { complete: true, processes };
    if (!Number.isInteger(record.ppid) || record.ppid <= 0) {
      return { complete: false, processes };
    }
    pid = record.ppid;
  }
  return { complete: false, processes };
}

module.exports = { processIdentity, processIdentityAlive, inspectProcessAncestry };
