# mcbots-report

What the bots failed at, where they died and what they finished, from the mcbots event archive. Run it before
and after a deploy; a fail cluster that keeps its count was not fixed.

```
curl -s https://bandit-lab.tail7facc9.ts.net:8445/api/archive/events.jsonl > /tmp/ev.jsonl
node tools/mcbots-report/report.js /tmp/ev.jsonl --days 4
```

- per bot and day: done / fail / death
- top 30 fails, digits masked as `#` (so "goto 1 2 3" and "goto 4 5 6" count as one)
- deaths by 32-block cell (x,z)

Plain Node, no dependencies (the lab has no python3). Test: `node tools/mcbots-report/report.test.js`.
