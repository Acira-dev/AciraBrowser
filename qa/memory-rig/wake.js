// Body for ev.sh: select every tab in turn (7 s each, so each page loads), then come back to the first. Returns who is awake.
for (const id of ['pin1','pin2','pin3','pin4','fav0','fav1','pin0']) { await act({type:'tab.select', id}); await sleep(7000); }
const s = await snap(); return s.tabs.map(t => [t.id, t.sleeping ? 'asleep' : 'awake', t.pinned ? 'pinned' : '']);
