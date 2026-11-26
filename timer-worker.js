// Steady ticks even when the recorder tab is in the background (page timers get throttled, worker timers don't).
let id = null;
onmessage = (e) => {
  if (e.data.cmd === 'start') {
    clearInterval(id);
    id = setInterval(() => postMessage(0), e.data.interval);
  } else if (e.data.cmd === 'stop') {
    clearInterval(id);
    id = null;
  }
};
